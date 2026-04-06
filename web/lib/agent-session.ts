/**
 * MPCP session — Trust Gateway via mpcp-gateway-client.
 *
 * Holds an active PolicyGrant + GatewaySession. Exposes:
 *   setGrant(grant)        — load a new grant, reset session
 *   getActiveSession()     — lazily create gateway session from grant
 *   getSessionState()      — snapshot for UI
 */
import { GatewayClient, type GatewaySession } from "mpcp-gateway-client";

const GATEWAY_URL = process.env.MPCP_GATEWAY_URL ?? "";
const GATEWAY_KEY = process.env.MPCP_GATEWAY_API_KEY ?? "";

interface AgentSessionGlobal {
  _grant:           unknown;
  _session:         GatewaySession | null;
  _grantSetAt:      Date | null;
  _allowedPurposes: string[];
  _ceilingDrops:    string;
  _grantId:         string | null;
  _expiresAt:       string | null;
  _revoked:         boolean;
  _client:          GatewayClient | null;
}
const _g = globalThis as typeof globalThis & { __agentSession?: AgentSessionGlobal };
if (!_g.__agentSession) {
  _g.__agentSession = {
    _grant: null, _session: null, _grantSetAt: null,
    _allowedPurposes: [], _ceilingDrops: "0", _grantId: null, _expiresAt: null,
    _revoked: false, _client: null,
  };
}
const state = _g.__agentSession;

function gatewayClient(): GatewayClient {
  if (!GATEWAY_URL || !GATEWAY_KEY) {
    throw new Error("MPCP_GATEWAY_URL and MPCP_GATEWAY_API_KEY must be set");
  }
  if (!state._client) {
    state._client = new GatewayClient({ gatewayUrl: GATEWAY_URL, apiKey: GATEWAY_KEY });
  }
  return state._client;
}

export interface SessionState {
  active:           boolean;
  revoked:          boolean;
  grantId:          string | null;
  allowedPurposes:  string[];
  ceilingDrops:     string;
  remainingDrops:   string | null;
  expiresAt:        string | null;
  grantSetAt:       string | null;
  gatewayAddress:   string;
  onChainSpentDrops: string | null;
}

export function hasGrant(): boolean {
  return state._grant !== null && !state._revoked;
}

export function clearGrant(): void {
  state._grant = null;
  state._session = null;
  state._grantSetAt = null;
  state._allowedPurposes = [];
  state._ceilingDrops = "0";
  state._grantId = null;
  state._expiresAt = null;
  state._revoked = false;
  state._client = null;
}

/**
 * Mark the grant as revoked locally AND revoke the gateway session server-side.
 * Best-effort: if the gateway call fails, local revocation still takes effect.
 */
export async function revokeGrant(): Promise<void> {
  state._revoked = true;
  if (state._session) {
    try { await state._session.revoke(); } catch { /* best-effort */ }
    state._session = null;
  }
}

export function setGrant(grant: unknown): void {
  const g = grant as Record<string, unknown>;
  const inner = (g.grant && typeof g.grant === "object")
    ? g.grant as Record<string, unknown>
    : g;
  state._grant           = grant;
  state._session         = null;
  state._client          = null;
  state._grantSetAt      = new Date();
  state._allowedPurposes = (inner.allowedPurposes as string[] | undefined) ?? [];
  state._grantId         = (inner.grantId as string | undefined) ?? null;
  state._expiresAt       = (inner.expiresAt as string | undefined) ?? null;
  state._ceilingDrops    = (inner.budgetMinor as string | undefined) ?? "0";
  state._revoked         = false;
}

export function getAllowedPurposes(): string[] {
  return state._allowedPurposes;
}

export function getGrantForVerification(): unknown {
  return state._grant;
}

/**
 * Force-create a session even if the grant is locally marked as revoked.
 * Used by the "malicious agent" demo scenario to show gateway-side enforcement.
 */
export async function getActiveSessionUnsafe(): Promise<GatewaySession> {
  if (!state._grant) throw new Error("No grant loaded — issue a grant first");
  state._session = null;
  const grant = state._grant as Record<string, unknown>;
  const expiresAt = state._expiresAt ?? new Date(Date.now() + 86_400_000).toISOString();
  const purposes = state._allowedPurposes.length > 0
    ? state._allowedPurposes
    : ["transport:toll", "transport:charging", "transport:parking"];
  state._session = await gatewayClient().createSession({
    budget:   { amount: state._ceilingDrops, currency: "XRP" },
    purposes,
    expiresAt,
    signedPolicyGrant: grant as Record<string, unknown>,
  });
  return state._session;
}

export async function getActiveSession(): Promise<GatewaySession> {
  if (state._revoked) throw new Error("Grant has been revoked");
  if (!state._grant) throw new Error("No grant loaded — issue a grant first");
  if (state._session) return state._session;

  const grant = state._grant as Record<string, unknown>;
  const expiresAt = state._expiresAt ?? new Date(Date.now() + 86_400_000).toISOString();
  const purposes = state._allowedPurposes.length > 0
    ? state._allowedPurposes
    : ["transport:toll", "transport:charging", "transport:parking"];

  state._session = await gatewayClient().createSession({
    budget:   { amount: state._ceilingDrops, currency: "XRP" },
    purposes,
    expiresAt,
    signedPolicyGrant: grant as Record<string, unknown>,
  });

  return state._session;
}

export async function getSessionState(): Promise<SessionState> {
  const gatewayAddress = process.env.XRPL_GATEWAY_ADDRESS ?? "—";

  const base: SessionState = {
    active:          !!state._grant,
    revoked:         state._revoked,
    grantId:         state._grantId,
    allowedPurposes: state._allowedPurposes,
    ceilingDrops:    state._ceilingDrops,
    remainingDrops:  null,
    expiresAt:       state._expiresAt,
    grantSetAt:      state._grantSetAt?.toISOString() ?? null,
    gatewayAddress,
    onChainSpentDrops: null,
  };

  if (!state._grant) return base;

  // Only query the gateway for remaining budget if we already have a session.
  // Never create a session here — that happens on actual payment actions.
  if (state._session) {
    try {
      const budget = await Promise.race([
        state._session.remaining(),
        new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
      ]);
      if (budget) base.remainingDrops = budget.remainingMinor.toString();
    } catch { /* gateway unreachable — return null remaining */ }
  }

  return base;
}
