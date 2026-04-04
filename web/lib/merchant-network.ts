/**
 * Per-merchant network state.
 *
 * Each merchant terminal can be toggled online / offline via the UI.
 * When offline the merchant simulates no internet connectivity:
 *   - XRPL payment submission and on-chain settlement verification are skipped.
 *   - Instead the merchant verifies the SBA + PolicyGrant entirely offline using
 *     a pre-downloaded, cryptographically-verified Trust Bundle.
 *
 * Trust Bundle lifecycle:
 *   1. downloadTrustBundle() fetches all non-expired bundles from the PA's
 *      GET /trust-bundles endpoint.
 *   2. Each bundle's signature is verified against the PA's public key, fetched
 *      from the PA's GET /.well-known/mpcp-keys.json endpoint (MPCP key discovery).
 *   3. The verified bundle is cached in memory and used for offline SBA +
 *      PolicyGrant signature verification via verifyMpcp + verifyPolicyGrant.
 */
import { createPublicKey } from "node:crypto";
import { verifyTrustBundle } from "mpcp-service/sdk";
import type { TrustBundle } from "mpcp-service/sdk";
import { MERCHANTS, type MerchantType } from "./merchants";
import { broadcast } from "./events";

export type NetworkStatus = "online" | "offline";

const PA_URL = process.env.POLICY_AUTHORITY_URL ?? "http://localhost:3001";
const NEXT_URL = process.env.AGENT_URL ?? "http://localhost:3001";

export interface PendingSettlement {
  sba: unknown;
  challenge: unknown;
  merchantType: MerchantType;
  amountXrp: string;
  acceptedAt: string;
}

interface MerchantNetworkState {
  status: NetworkStatus;
  /** Verified trust bundles cached at last go-offline event */
  trustBundles: TrustBundle[];
  /** ISO timestamp of last successful bundle download */
  bundlesCachedAt: string | null;
  /** SBAs accepted offline, pending XRPL settlement when back online */
  pendingSettlements: PendingSettlement[];
}

// Anchor to globalThis so all Next.js route bundles share one instance.
const _g = globalThis as typeof globalThis & {
  __merchantNetwork?: Record<MerchantType, MerchantNetworkState>;
};
if (!_g.__merchantNetwork) {
  const init = (): MerchantNetworkState => ({
    status: "online", trustBundles: [], bundlesCachedAt: null, pendingSettlements: [],
  });
  _g.__merchantNetwork = { toll: init(), charging: init(), parking: init() };
}
const _state = _g.__merchantNetwork!;

export function getMerchantNetworkStatus(type: MerchantType): NetworkStatus {
  return _state[type].status;
}

export function getCachedTrustBundles(type: MerchantType): TrustBundle[] {
  return _state[type].trustBundles;
}

export function getMerchantNetworkInfo(type: MerchantType): {
  status: NetworkStatus;
  bundlesCachedAt: string | null;
  bundleCount: number;
  pendingCount: number;
} {
  const s = _state[type];
  return {
    status: s.status,
    bundlesCachedAt: s.bundlesCachedAt,
    bundleCount: s.trustBundles.length,
    pendingCount: s.pendingSettlements.length,
  };
}

export function queuePendingSettlement(
  type: MerchantType,
  sba: unknown,
  challenge: unknown,
  amountXrp: string,
): void {
  _state[type].pendingSettlements.push({
    sba,
    challenge,
    merchantType: type,
    amountXrp,
    acceptedAt: new Date().toISOString(),
  });
}

function drainPendingSettlements(type: MerchantType): PendingSettlement[] {
  const pending = _state[type].pendingSettlements;
  _state[type].pendingSettlements = [];
  return pending;
}

export function getAllMerchantNetworkStatus(): Record<MerchantType, NetworkStatus> {
  return {
    toll:     _state.toll.status,
    charging: _state.charging.status,
    parking:  _state.parking.status,
  };
}

/**
 * Download and verify trust bundles from the PA, then cache them for the
 * given merchant.
 *
 * Verification steps:
 *  1. Fetch the PA's JWKS to find the bundle root public key.
 *  2. Fetch all non-expired bundles from GET /trust-bundles.
 *  3. For each bundle, call verifyTrustBundle(bundle, rootPubKeyPem).
 *  4. Only verified, non-expired bundles are stored.
 *
 * Returns the list of verified bundles (may be empty on error).
 */
export async function downloadAndCacheTrustBundles(
  type: MerchantType,
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    // ── 1. Fetch PA's JWKS ──────────────────────────────────────────────────
    const jwksRes = await fetch(`${PA_URL}/.well-known/mpcp-keys.json`, {
      headers: { Accept: "application/json" },
    });
    if (!jwksRes.ok) {
      return { ok: false, count: 0, error: `JWKS fetch failed: HTTP ${jwksRes.status}` };
    }
    const { keys } = await jwksRes.json() as { keys: Array<Record<string, unknown>> };
    if (!Array.isArray(keys) || keys.length === 0) {
      return { ok: false, count: 0, error: "PA JWKS is empty" };
    }

    // Build a map of kid → PEM public key for all active PA keys.
    const paKeysByKid = new Map<string, string>();
    for (const jwk of keys) {
      if (typeof jwk.kid !== "string") continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pem = createPublicKey({ key: jwk as any, format: "jwk" })
          .export({ type: "spki", format: "pem" })
          .toString();
        paKeysByKid.set(jwk.kid, pem);
      } catch {
        // skip malformed JWK entries
      }
    }

    // ── 2. Fetch trust bundles from PA ────────────────────────────────────
    const bundlesRes = await fetch(`${PA_URL}/trust-bundles`, {
      headers: { Accept: "application/json" },
    });
    if (!bundlesRes.ok) {
      return { ok: false, count: 0, error: `Trust bundle fetch failed: HTTP ${bundlesRes.status}` };
    }
    const { bundles } = await bundlesRes.json() as { bundles: TrustBundle[] };
    if (!Array.isArray(bundles) || bundles.length === 0) {
      return { ok: false, count: 0, error: "No trust bundles available from PA" };
    }

    // ── 3. Verify each bundle using the PA's public key ───────────────────
    const verified: TrustBundle[] = [];
    for (const bundle of bundles) {
      const rootPem = paKeysByKid.get(bundle.bundleKeyId);
      if (!rootPem) {
        // Bundle signed with a key not in current JWKS — skip.
        continue;
      }
      const result = verifyTrustBundle(bundle, rootPem);
      if (result.valid) {
        verified.push(bundle);
      }
    }

    if (verified.length === 0) {
      return { ok: false, count: 0, error: "All bundles failed signature verification" };
    }

    // ── 4. Cache ──────────────────────────────────────────────────────────
    _state[type].trustBundles = verified;
    _state[type].bundlesCachedAt = new Date().toISOString();

    return { ok: true, count: verified.length };
  } catch (err) {
    return { ok: false, count: 0, error: String(err) };
  }
}

/**
 * Set merchant network status.  When going offline, trigger a trust bundle
 * download first so the merchant is ready to verify payments without internet.
 * When coming back online, settle any pending offline payments via the signer.
 * Returns the cached bundle count (0 on download failure).
 */
export async function setMerchantNetworkStatus(
  type: MerchantType,
  status: NetworkStatus,
): Promise<{ ok: boolean; bundleCount: number; error?: string }> {
  if (status === "offline") {
    const result = await downloadAndCacheTrustBundles(type);
    if (!result.ok) {
      return { ok: false, bundleCount: 0, error: result.error };
    }
    _state[type].status = "offline";
    return { ok: true, bundleCount: result.count };
  }

  _state[type].status = "online";

  // Fire-and-forget: settle any pending offline payments in the background.
  const pending = drainPendingSettlements(type);
  if (pending.length > 0) {
    settlePendingPayments(pending).catch((err) =>
      console.error("[merchant-network] settlePendingPayments error:", err),
    );
  }

  return { ok: true, bundleCount: _state[type].trustBundles.length };
}

/**
 * Settle offline-accepted SBAs by submitting each to the gateway signer,
 * which signs and broadcasts the XRPL Payment transaction.
 */
async function settlePendingPayments(pending: PendingSettlement[]): Promise<void> {
  const merchant = MERCHANTS[pending[0].merchantType];

  broadcast("xrpl:signing",
    `Settling ${pending.length} deferred ${merchant.name} payment(s)…`, {
      merchantType: pending[0].merchantType,
    });

  let settled = 0;
  let failed = 0;

  for (const entry of pending) {
    const sbaB64 = Buffer.from(JSON.stringify(entry.sba)).toString("base64");

    try {
      const res = await fetch(`${NEXT_URL}/api/signer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sba: sbaB64, challenge: entry.challenge }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        const msg = err.message ?? `HTTP ${res.status}`;
        broadcast("error",
          `Deferred settlement failed (${merchant.name}, ${entry.amountXrp} XRP): ${msg}`, {
            merchantType: entry.merchantType,
            dev: { rawError: msg },
          });
        failed++;
        continue;
      }

      const { txHash, xrpScanUrl } = await res.json() as { txHash: string; xrpScanUrl: string };
      broadcast("xrpl:confirmed",
        `Deferred ${merchant.name} payment settled — ${entry.amountXrp} XRP`, {
          merchantType: entry.merchantType,
          dev: { txHash, xrpScanUrl },
        });
      settled++;
    } catch (err) {
      broadcast("error",
        `Deferred settlement error (${merchant.name}): ${err}`, {
          merchantType: entry.merchantType,
          dev: { rawError: String(err) },
        });
      failed++;
    }
  }

  if (settled > 0 || failed > 0) {
    broadcast("xrpl:confirmed",
      `Deferred settlement complete: ${settled} settled, ${failed} failed`, {
        merchantType: pending[0].merchantType,
      });
  }
}
