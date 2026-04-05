/**
 * Typed client-side fetch helpers for the web app's own API routes.
 */
import type { DemoEvent } from "./events";
import type { SessionState } from "./agent-session";
import type { GrantPreset } from "./merchants";

const BASE = "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res  = await fetch(`${BASE}${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  return body as T;
}

// ── Session ───────────────────────────────────────────────────────────────────

export const sessionApi = {
  get: () => call<SessionState>("/api/session"),
};

// ── Grants ────────────────────────────────────────────────────────────────────

export interface IssueGrantResult {
  grant: unknown;
  grantId: string | null;
}

export const grantsApi = {
  issue: (preset: GrantPreset, ttlHours: number) =>
    call<IssueGrantResult>("/api/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset, ttlHours }),
    }),
  revoke: (grantId: string) =>
    call<{ ok: boolean }>("/api/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId }),
    }),
};

// ── Actions ───────────────────────────────────────────────────────────────────

export interface ActionResult {
  ok: boolean;
  message: string;
  txHash?: string;
  xrpScanUrl?: string;
  denied?: boolean;
  deniedReason?: string;
}

export const actionApi = {
  trigger: (type: "toll" | "charging" | "parking") =>
    call<ActionResult>("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    }),
};

// ── Merchants ─────────────────────────────────────────────────────────────────

export interface MerchantInfo {
  type: "toll" | "charging" | "parking";
  address: string;
  balance: string; // drops
  name: string;
  emoji: string;
  amountXrp: string;
  networkStatus: "online" | "offline";
  bundlesCachedAt: string | null;
  bundleCount: number;
  pendingCount: number;
}

export const merchantsApi = {
  list: () => call<MerchantInfo[]>("/api/merchants"),
};

// ── Merchant controls ─────────────────────────────────────────────────────────

export const merchantControlsApi = {
  setNetwork: (type: "toll" | "charging" | "parking", status: "online" | "offline") =>
    call<{ ok: boolean; type: string; status: string; bundleCount: number }>("/api/merchant-controls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, status }),
    }),
};

// ── Demo scenario controls ───────────────────────────────────────────────────

export const demoApi = {
  getPaStatus: () => call<{ running: boolean }>("/api/demo/pa-control"),
  setPa: (action: "start" | "stop") =>
    call<{ ok: boolean; running: boolean; message?: string }>("/api/demo/pa-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
  getAgentMode: () => call<{ mode: "honest" | "malicious" }>("/api/demo/agent-mode"),
  setAgentMode: (mode: "honest" | "malicious") =>
    call<{ mode: string }>("/api/demo/agent-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }),
};

// Re-export types used by components
export type { DemoEvent, SessionState, GrantPreset };
