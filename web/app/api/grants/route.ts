import { NextRequest, NextResponse } from "next/server";
import { signerState } from "@/lib/signer-state";
import { setGrant } from "@/lib/agent-session";
import { ensurePaReady, PaBootstrapError, POLICY_DOCUMENT } from "@/lib/pa-bootstrap";
import { broadcast } from "@/lib/events";
import { xrpScanUrl } from "@/lib/xrpl";
import type { GrantPreset } from "@/lib/merchants";

const PA_URL        = process.env.POLICY_AUTHORITY_URL ?? "http://localhost:3000";
const GATEWAY_ADDR  = process.env.XRPL_GATEWAY_ADDRESS ?? "";

export async function POST(req: NextRequest) {
  const { preset, ttlHours }: { preset: GrantPreset; ttlHours: number } = await req.json();

  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();

  let paKey: string;
  let policyHash: string;
  try {
    ({ paKey, policyHash } = await ensurePaReady());
  } catch (err) {
    const msg = err instanceof PaBootstrapError ? err.message : String(err);
    return NextResponse.json({ error: "pa_bootstrap_failed", message: msg }, { status: 503 });
  }

  // ── Ask PA to sign the grant (all fields included in signature) ──────────
  const grantBody = {
    policyHash,
    allowedRails:                ["xrpl"],
    allowedPurposes:             preset.purposes,
    expiresAt,
    budgetMinor:                 preset.budgetDrops,
    budgetCurrency:              "XRP",
    authorizedGateway:           GATEWAY_ADDR || undefined,
    offlineMaxSinglePayment:     preset.offlineMaxSinglePaymentDrops,
    offlineMaxSinglePaymentCurrency: "XRP",
  };

  const paRes = await fetch(`${PA_URL}/grants`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${paKey}` },
    body:    JSON.stringify(grantBody),
  });

  if (!paRes.ok) {
    const err = await paRes.text();
    return NextResponse.json({ error: `PA error ${paRes.status}: ${err}` }, { status: 502 });
  }

  const signedEnvelope = await paRes.json() as Record<string, unknown>;

  const innerGrant = (signedEnvelope.grant && typeof signedEnvelope.grant === "object")
    ? signedEnvelope.grant as Record<string, unknown>
    : signedEnvelope;

  const grantId       = innerGrant.grantId as string | undefined ?? null;
  const budgetMinor   = innerGrant.budgetMinor as string | undefined ?? preset.budgetDrops;
  const credentialTxHash = signedEnvelope.credentialTxHash as string | undefined;

  setGrant(signedEnvelope);
  signerState.setGrant({
    grantId,
    ceilingDrops: budgetMinor,
    authorizedGateway: innerGrant.authorizedGateway as string | undefined ?? null,
  });

  const credentialLabel = credentialTxHash ? ` | credential` : "";
  const isRealHash = credentialTxHash && /^[A-F0-9]{64}$/i.test(credentialTxHash);

  broadcast(
    "grant:issued",
    `Grant issued — ${preset.label} (${preset.budgetXrp} XRP budget, PA-signed${credentialLabel})`,
    {
      dev: {
        grant: signedEnvelope,
        policy: { policyHash, policyDocument: POLICY_DOCUMENT },
        ...(credentialTxHash ? { txHash: credentialTxHash } : {}),
        ...(isRealHash ? { xrpScanUrl: xrpScanUrl(credentialTxHash) } : {}),
      },
    },
  );

  return NextResponse.json({ grant: signedEnvelope, grantId });
}
