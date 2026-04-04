/**
 * Lazy PA bootstrap — creates grants:write + grants:revoke API key on first use,
 * then registers the robotaxi inference policy, then ensures a Trust Bundle is
 * published so merchants can verify SBAs + PolicyGrants fully offline.
 *
 * Trust Bundle contents:
 *   - approvedIssuers: [paDomain]
 *   - issuers[paDomain].keys: [PA grant-signing key JWK, SBA signing key JWK]
 *
 * Merchants fetch this bundle from GET /trust-bundles, verify its signature via
 * the PA's /.well-known/mpcp-keys.json, and use the embedded keys to verify both the
 * PolicyGrant (signed with the PA's grant-signing key) and the SBA (signed with
 * the agent's SBA-signing key) without any live network access.
 */
import { createPublicKey } from "node:crypto";

const PA_URL       = process.env.POLICY_AUTHORITY_URL ?? "http://localhost:3000";
const PA_ADMIN_KEY = process.env.PA_ADMIN_KEY;

export const POLICY_DOCUMENT = {
  type: "robotaxi:transport",
  description: "Autonomous vehicle transport payment policy",
  allowedPurposes: ["transport:toll", "transport:charging", "transport:parking"],
  allowedRails: ["xrpl"],
};

const TRUST_BUNDLE_ID = "robotaxi-transport-bundle-v1";

// Anchor mutable state to globalThis so all Next.js route bundles share one instance.
const _g = globalThis as typeof globalThis & {
  __paBs?: { key: string | null; policyHash: string | null; trustBundleIssued: boolean };
};
if (!_g.__paBs) _g.__paBs = { key: null, policyHash: null, trustBundleIssued: false };
const _cache = _g.__paBs;

export class PaBootstrapError extends Error {
  constructor(msg: string) { super(msg); this.name = "PaBootstrapError"; }
}

export async function ensurePaReady(): Promise<{ paKey: string; policyHash: string }> {
  if (_cache.key && _cache.policyHash) return { paKey: _cache.key, policyHash: _cache.policyHash };

  if (!PA_ADMIN_KEY) {
    throw new PaBootstrapError("PA_ADMIN_KEY is not set");
  }

  if (!_cache.key) {
    const res = await fetch(`${PA_URL}/admin/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${PA_ADMIN_KEY}` },
      body: JSON.stringify({ scopes: ["grants:write", "grants:revoke"] }),
    });
    if (!res.ok) throw new PaBootstrapError(`PA /admin/keys: HTTP ${res.status}: ${await res.text()}`);
    const { key } = await res.json() as { key: string };
    _cache.key = key;
  }

  if (!_cache.policyHash) {
    const res = await fetch(`${PA_URL}/policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${_cache.key}` },
      body: JSON.stringify({ policyDocument: POLICY_DOCUMENT }),
    });
    if (!res.ok) throw new PaBootstrapError(`PA /policies: HTTP ${res.status}: ${await res.text()}`);
    const { policyHash } = await res.json() as { policyHash: string };
    _cache.policyHash = policyHash;
  }

  // ── Issue (or refresh) the Trust Bundle so offline merchants can verify ──
  if (!_cache.trustBundleIssued) {
    try {
      await ensureTrustBundle(_cache.key!);
      _cache.trustBundleIssued = true;
    } catch (err) {
      // Trust bundle issuance failure is non-fatal for online operation — log and continue.
      console.warn("[pa-bootstrap] Trust bundle issuance failed (offline payments will not work):", err);
    }
  }

  return { paKey: _cache.key!, policyHash: _cache.policyHash! };
}

/**
 * POST /trust-bundles to the PA with both signing keys embedded so offline
 * merchants can verify PolicyGrants and SBAs using only the cached bundle.
 *
 * The PA domain is resolved from POLICY_AUTHORITY_URL and used as:
 *   - approvedIssuers[0]   — the trusted grant-issuing authority
 *   - issuers[0].issuer    — the domain under which keys are listed
 *
 * Two keys are included per issuer entry:
 *   1. The PA's grant-signing public key (fetched from the PA's JWKS endpoint).
 *   2. The agent's SBA-signing public key (from MPCP_SBA_SIGNING_PUBLIC_KEY_PEM).
 *
 * Keys are identified by their kid (key IDs), which must match the issuerKeyId
 * fields in PolicyGrant and SBA artifacts respectively.
 */
async function ensureTrustBundle(paKey: string): Promise<void> {
  const paDomain = new URL(PA_URL).host; // e.g., "localhost:3000"

  // ── Collect keys to embed ─────────────────────────────────────────────────
  const keys: object[] = [];

  // 1. Fetch the PA's grant-signing public key from its JWKS endpoint.
  try {
    const jwksRes = await fetch(`${PA_URL}/.well-known/mpcp-keys.json`);
    if (jwksRes.ok) {
      const { keys: jwks } = await jwksRes.json() as { keys: Array<Record<string, unknown>> };
      for (const jwk of jwks) {
        if (typeof jwk.kid === "string" && jwk.active !== false) {
          keys.push(jwk);
        }
      }
    } else {
      console.warn(`[pa-bootstrap] Failed to fetch PA JWKS: HTTP ${jwksRes.status}`);
    }
  } catch (err) {
    console.warn("[pa-bootstrap] Failed to fetch PA JWKS:", err);
  }

  // 2. Add the agent's SBA-signing public key.
  const sbaPem = process.env.MPCP_SBA_SIGNING_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
  const sbaKeyId = process.env.MPCP_SBA_SIGNING_KEY_ID ?? "mpcp-sba-signing-key-1";
  if (sbaPem) {
    try {
      const jwk = createPublicKey({ key: sbaPem, format: "pem" })
        .export({ format: "jwk" }) as Record<string, unknown>;
      keys.push({ ...jwk, kid: sbaKeyId });
    } catch (err) {
      throw new Error(`Failed to export SBA-signing key as JWK: ${err}`);
    }
  } else {
    throw new Error("MPCP_SBA_SIGNING_PUBLIC_KEY_PEM not set — cannot issue trust bundle");
  }

  if (keys.length === 0) {
    throw new Error("No keys available to embed in trust bundle");
  }

  // ── POST to PA /trust-bundles ─────────────────────────────────────────────
  const expiresAt = new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(); // 30 days
  const res = await fetch(`${PA_URL}/trust-bundles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${paKey}` },
    body: JSON.stringify({
      bundleId:        TRUST_BUNDLE_ID,
      category:        "robotaxi:transport",
      approvedIssuers: [paDomain],
      issuers:         [{ issuer: paDomain, keys }],
      expiresAt,
    }),
  });

  if (!res.ok) {
    throw new Error(`PA /trust-bundles: HTTP ${res.status}: ${await res.text()}`);
  }

  console.log(`[pa-bootstrap] Trust bundle '${TRUST_BUNDLE_ID}' issued (${keys.length} key(s), expires ${expiresAt})`);
}
