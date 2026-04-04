/**
 * Server-side SSE event emitter.
 * Broadcast demo events from API routes; subscribe in the SSE route.
 */
import { EventEmitter } from "node:events";
import type { MerchantType } from "./merchants";

export type EventType =
  | "robotaxi:arriving"
  | "merchant:challenge"
  | "mpcp:checking"
  | "mpcp:approved"
  | "mpcp:denied"
  | "xrpl:signing"
  | "xrpl:submitted"
  | "xrpl:confirmed"
  | "merchant:access_granted"
  | "merchant:access_denied"
  | "grant:issued"
  | "grant:revoked"
  | "error";

export interface DemoEvent {
  id: string;
  timestamp: string;
  type: EventType;
  merchantType?: MerchantType;
  robotaxiId?: string;
  message: string;
  /** Raw artifacts for the Dev View toggle */
  dev?: {
    grant?: unknown;
    policy?: unknown;
    sba?: unknown;
    challenge?: unknown;
    txHash?: string;
    xrpScanUrl?: string;
    rawError?: string;
    offlineMode?: boolean;
    bundleCount?: number;
    verificationLevel?: "full" | "signature-only";
  };
}

const _eg = globalThis as typeof globalThis & { __demoEmitter?: EventEmitter; __demoSeq?: number };
if (!_eg.__demoEmitter) { _eg.__demoEmitter = new EventEmitter(); _eg.__demoEmitter.setMaxListeners(100); }
if (_eg.__demoSeq === undefined) _eg.__demoSeq = 0;
const emitter = _eg.__demoEmitter;

export function broadcast(
  type: EventType,
  message: string,
  extra?: Omit<DemoEvent, "id" | "timestamp" | "type" | "message">
): DemoEvent {
  const event: DemoEvent = {
    id: String(++_eg.__demoSeq!),
    timestamp: new Date().toISOString(),
    type,
    message,
    ...extra,
  };
  emitter.emit("demo", event);
  return event;
}

export function subscribe(handler: (e: DemoEvent) => void): () => void {
  emitter.on("demo", handler);
  return () => emitter.off("demo", handler);
}
