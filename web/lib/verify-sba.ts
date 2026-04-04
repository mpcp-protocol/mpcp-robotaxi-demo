/**
 * SBA verification for merchant routes — uses mpcp-service (no mpcp-merchant-sdk).
 *
 * Two modes:
 *   verifySba()        — online mode. Verifies SBA sig via env-var public key.
 *   verifySbaOffline() — offline mode. Verifies SBA + PolicyGrant via Trust Bundle.
 */
import {
  verifySignedBudgetAuthorization,
  verifyPolicyGrant,
} from "mpcp-service/sdk";
import type {
  SignedBudgetAuthorization,
  PaymentPolicyDecision,
  Rail,
  TrustBundle,
} from "mpcp-service/sdk";

export interface SbaVerifyResult {
  ok: boolean;
  reason?: string;
}

function isSignedSba(value: unknown): value is SignedBudgetAuthorization {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!v.authorization || typeof v.authorization !== "object") return false;
  const auth = v.authorization as Record<string, unknown>;
  return (
    typeof v.signature === "string" &&
    typeof v.issuerKeyId === "string" &&
    typeof auth.version === "string" &&
    typeof auth.budgetId === "string" &&
    typeof auth.grantId === "string" &&
    typeof auth.sessionId === "string" &&
    typeof auth.actorId === "string" &&
    typeof auth.policyHash === "string" &&
    typeof auth.currency === "string" &&
    typeof auth.maxAmountMinor === "string" &&
    typeof auth.budgetScope === "string" &&
    typeof auth.minorUnit === "number" &&
    typeof auth.expiresAt === "string" &&
    Array.isArray(auth.allowedRails) &&
    Array.isArray(auth.allowedAssets) &&
    Array.isArray(auth.destinationAllowlist)
  );
}

function syntheticDecision(
  sba: SignedBudgetAuthorization,
  amount: string,
  rail?: Rail,
): PaymentPolicyDecision {
  const decision: PaymentPolicyDecision = {
    action: "ALLOW",
    reasons: [],
    policyHash: sba.authorization.policyHash,
    expiresAtISO: sba.authorization.expiresAt,
    decisionId: sba.authorization.budgetId,
    sessionGrantId: sba.authorization.grantId,
    priceFiat: { amountMinor: amount, currency: sba.authorization.currency },
  };
  if (rail !== undefined) decision.rail = rail;
  return decision;
}

function runVerifySync(
  sba: SignedBudgetAuthorization,
  input: Parameters<typeof verifySignedBudgetAuthorization>[1],
  signingKeyPem: string | undefined,
  signingKeyId: string | undefined,
): ReturnType<typeof verifySignedBudgetAuthorization> {
  const prevPublicKey = process.env.MPCP_SBA_SIGNING_PUBLIC_KEY_PEM;
  const prevKeyId = process.env.MPCP_SBA_SIGNING_KEY_ID;
  if (signingKeyPem !== undefined) process.env.MPCP_SBA_SIGNING_PUBLIC_KEY_PEM = signingKeyPem;
  if (signingKeyId !== undefined) process.env.MPCP_SBA_SIGNING_KEY_ID = signingKeyId;
  try {
    return verifySignedBudgetAuthorization(sba, input);
  } finally {
    if (signingKeyPem !== undefined) {
      if (prevPublicKey === undefined) delete process.env.MPCP_SBA_SIGNING_PUBLIC_KEY_PEM;
      else process.env.MPCP_SBA_SIGNING_PUBLIC_KEY_PEM = prevPublicKey;
    }
    if (signingKeyId !== undefined) {
      if (prevKeyId === undefined) delete process.env.MPCP_SBA_SIGNING_KEY_ID;
      else process.env.MPCP_SBA_SIGNING_KEY_ID = prevKeyId;
    }
  }
}

/** Online SBA verification — uses MPCP_SBA_SIGNING_PUBLIC_KEY_PEM env var. */
export async function verifySba(
  sbaJson: unknown,
  amountDrops: bigint,
): Promise<SbaVerifyResult> {
  const pubKeyPem = process.env.MPCP_SBA_SIGNING_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
  if (!pubKeyPem) {
    return { ok: false, reason: "MPCP_SBA_SIGNING_PUBLIC_KEY_PEM not set" };
  }

  if (!isSignedSba(sbaJson)) {
    return { ok: false, reason: "Not a valid SignedBudgetAuthorization" };
  }
  const sba = sbaJson;
  const auth = sba.authorization;
  if (auth.currency !== "XRP") {
    return { ok: false, reason: `Currency mismatch: expected XRP, SBA uses ${auth.currency}` };
  }

  const decision = syntheticDecision(sba, amountDrops.toString(), "xrpl");
  const result = runVerifySync(
    sba,
    {
      sessionId: auth.sessionId,
      decision,
      cumulativeSpentMinor: "0",
      trustBundles: undefined,
      clockDriftToleranceMs: undefined,
    },
    pubKeyPem,
    process.env.MPCP_SBA_SIGNING_KEY_ID,
  );

  if (!result.ok) {
    const r = result.reason;
    const detail =
      r === "invalid_signature" ? "Invalid signature or key mismatch"
        : r === "expired" ? "SBA has expired"
          : r === "budget_exceeded" ? "Amount exceeds authorized budget"
            : r === "mismatch" ? "SBA fields do not match decision"
              : "Verification failed";
    return { ok: false, reason: detail };
  }

  return { ok: true };
}

/**
 * Offline SBA + PolicyGrant verification — uses Trust Bundle only, no env vars.
 */
export async function verifySbaOffline(
  sbaJson: unknown,
  grant: unknown,
  amountDrops: bigint,
  trustBundles: TrustBundle[],
): Promise<SbaVerifyResult> {
  if (trustBundles.length === 0) {
    return { ok: false, reason: "No trust bundles cached — cannot verify offline" };
  }

  if (!isSignedSba(sbaJson)) {
    return { ok: false, reason: "SBA: Not a valid SignedBudgetAuthorization" };
  }
  const sba = sbaJson;
  const auth = sba.authorization;

  const decision = syntheticDecision(sba, amountDrops.toString(), "xrpl");
  const sbaResult = runVerifySync(
    sba,
    {
      sessionId: auth.sessionId,
      decision,
      cumulativeSpentMinor: "0",
      trustBundles,
      clockDriftToleranceMs: undefined,
    },
    undefined,
    undefined,
  );

  if (!sbaResult.ok) {
    const r = sbaResult.reason;
    const detail =
      r === "invalid_signature" ? "Invalid signature"
        : r === "expired" ? "SBA expired"
          : r === "budget_exceeded" ? "Budget exceeded"
            : r === "mismatch" ? "SBA mismatch"
              : "SBA verification failed";
    return { ok: false, reason: `SBA: ${detail}` };
  }

  const g = grant as Record<string, unknown>;
  const innerGrant = (g.grant && typeof g.grant === "object")
    ? g.grant as Record<string, unknown>
    : g;
  const flatGrant: Record<string, unknown> = {
    ...innerGrant,
    issuerKeyId: g.issuerKeyId ?? innerGrant.issuerKeyId,
    signature:   g.signature   ?? innerGrant.signature,
    issuer:      g.issuer      ?? innerGrant.issuer,
  };
  const grantResult = verifyPolicyGrant(flatGrant, { trustBundles });
  if (!grantResult.valid) {
    return { ok: false, reason: `PolicyGrant: ${grantResult.reason}` };
  }

  const offlineCap = innerGrant.offlineMaxSinglePayment as string | undefined;
  if (offlineCap) {
    const sbaObj = sbaJson as { authorization?: { maxAmountMinor?: string } };
    const txAmount = BigInt(sbaObj?.authorization?.maxAmountMinor ?? "0");
    if (txAmount > BigInt(offlineCap)) {
      return {
        ok: false,
        reason: `Exceeds offline per-transaction limit: ${txAmount} > ${offlineCap} drops`,
      };
    }
  }

  return { ok: true };
}
