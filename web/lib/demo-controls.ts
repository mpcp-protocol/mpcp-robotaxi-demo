/**
 * Demo scenario controls — shared server-side state.
 *
 * Agent mode: "honest" (default) or "malicious" (bypasses agent-side policy checks).
 * PA status: cached health-check result against the Policy Authority.
 */

const PA_URL = process.env.POLICY_AUTHORITY_URL ?? "http://localhost:3000";

type AgentMode = "honest" | "malicious";

interface DemoControlsGlobal {
  agentMode: AgentMode;
  paRunning: boolean | null;
  paCheckAt: number;
}

const _g = globalThis as typeof globalThis & { __demoControls?: DemoControlsGlobal };
if (!_g.__demoControls) {
  _g.__demoControls = { agentMode: "honest", paRunning: null, paCheckAt: 0 };
}
const ctrl = _g.__demoControls;

export function getAgentMode(): AgentMode { return ctrl.agentMode; }
export function setAgentMode(mode: AgentMode): void { ctrl.agentMode = mode; }
export function isMalicious(): boolean { return ctrl.agentMode === "malicious"; }

const PA_CHECK_TTL_MS = 3_000;

export async function checkPaHealth(): Promise<boolean> {
  const now = Date.now();
  if (ctrl.paRunning !== null && now - ctrl.paCheckAt < PA_CHECK_TTL_MS) {
    return ctrl.paRunning;
  }
  try {
    const res = await fetch(`${PA_URL}/health`, { signal: AbortSignal.timeout(1_500) });
    ctrl.paRunning = res.ok;
  } catch {
    ctrl.paRunning = false;
  }
  ctrl.paCheckAt = now;
  return ctrl.paRunning;
}

export function invalidatePaCache(): void {
  ctrl.paRunning = null;
  ctrl.paCheckAt = 0;
}
