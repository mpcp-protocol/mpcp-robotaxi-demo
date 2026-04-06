/**
 * Demo scenario controls — shared server-side state.
 *
 * Agent mode: "honest" (default) or "malicious" (bypasses agent-side policy checks).
 * PA status: TCP connect probe (non-blocking, no HTTP fetch that can hang).
 */

import { createConnection } from "node:net";

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

const PA_CHECK_TTL_MS = 2_000;

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port, timeout: timeoutMs });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error",   () => { sock.destroy(); resolve(false); });
  });
}

let _broadcastFn: ((type: string, msg: string) => void) | null = null;

export function setBroadcastFn(fn: (type: string, msg: string) => void): void {
  _broadcastFn = fn;
}

export async function checkPaHealth(): Promise<boolean> {
  const now = Date.now();
  if (ctrl.paRunning !== null && now - ctrl.paCheckAt < PA_CHECK_TTL_MS) {
    return ctrl.paRunning;
  }
  const prev = ctrl.paRunning;
  ctrl.paRunning = await tcpProbe("127.0.0.1", 3000, 800);
  ctrl.paCheckAt = now;

  if (prev === false && ctrl.paRunning && _broadcastFn) {
    _broadcastFn("infra:pa_started", "Policy Authority started and healthy");
  }

  return ctrl.paRunning;
}

export function invalidatePaCache(): void {
  ctrl.paRunning = null;
  ctrl.paCheckAt = 0;
}
