"use client";
import { useState } from "react";
import { actionApi, type SessionState, type ActionResult } from "@/lib/api";
import { MERCHANTS } from "@/lib/merchants";

interface Props {
  session: SessionState | null;
  onAction: () => void;
}

export function RobotaxiPanel({ session, onAction }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  async function trigger(type: "toll" | "charging" | "parking") {
    setLoading(type);
    setLastResult(null);
    try {
      const result = await actionApi.trigger(type);
      setLastResult(result);
      onAction();
    } catch (e) {
      setLastResult({ ok: false, message: String(e) });
    } finally {
      setLoading(null);
    }
  }

  const isActive = session?.active;
  const isRevoked = session?.revoked;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-widest">Robotaxi Simulator</h2>
          <span className="font-mono text-xs text-accent">TX-001</span>
        </div>
        {!isActive && (
          <span className="text-xs text-warn">Issue a grant to enable payments</span>
        )}
        {isRevoked && (
          <span className="text-xs text-danger">⚠ Grant revoked — transactions will be rejected</span>
        )}
      </div>

      <div className="flex gap-3">
        {(["toll", "charging", "parking"] as const).map((type) => {
          const m = MERCHANTS[type];
          const allowed = session?.allowedPurposes.includes(m.purpose);
          const isLoading = loading === type;

          return (
            <button
              key={type}
              onClick={() => trigger(type)}
              disabled={!!loading || !isActive}
              className={`flex-1 py-3 rounded-lg border transition-all ${
                !isActive
                  ? "border-border text-muted opacity-40 cursor-not-allowed"
                  : allowed
                  ? "border-accent/30 hover:border-accent hover:bg-accent/5 text-white"
                  : "border-danger/30 hover:border-danger hover:bg-danger/5 text-danger/80"
              } ${isLoading ? "animate-pulse" : ""}`}
            >
              <div className="text-2xl mb-1">{m.emoji}</div>
              <div className="text-sm font-medium">{m.name}</div>
              <div className="text-xs text-muted mt-0.5">{m.amountXrp} XRP</div>
              {isActive && !allowed && (
                <div className="text-xs text-danger mt-1">⛔ blocked</div>
              )}
              {isLoading && <div className="text-xs text-accent mt-1">Processing…</div>}
            </button>
          );
        })}
      </div>

      {lastResult && (
        <div className={`mt-3 p-2 rounded text-xs ${lastResult.ok ? "bg-green/5 text-green border border-green/20" : lastResult.denied ? "bg-danger/5 text-danger border border-danger/20" : "bg-warn/5 text-warn border border-warn/20"}`}>
          {lastResult.ok
            ? `✓ ${lastResult.message}`
            : lastResult.denied
            ? `⛔ ${lastResult.deniedReason ?? lastResult.message}`
            : `⚠ ${lastResult.message}`}
          {lastResult.xrpScanUrl && (
            <a href={lastResult.xrpScanUrl} target="_blank" rel="noopener noreferrer"
              className="ml-2 text-accent hover:underline">
              View on XRPScan ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
