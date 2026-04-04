"use client";
import { useState } from "react";
import { grantsApi, type SessionState, type GrantPreset } from "@/lib/api";
import { GRANT_PRESETS } from "@/lib/merchants";

interface Props {
  session: SessionState | null;
  onGrantChange: () => void;
  devView: boolean;
}

function dropsToXrp(drops: string | null): string {
  if (!drops) return "—";
  const n = BigInt(drops);
  const xrp = Number(n) / 1_000_000;
  return xrp.toFixed(xrp < 0.01 ? 6 : 2);
}

function pct(remaining: string | null, ceiling: string): number {
  if (!remaining) return 100;
  const r = Number(remaining), c = Number(ceiling);
  if (c === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((r / c) * 100)));
}

export function FleetPanel({ session, onGrantChange, devView }: Props) {
  const [selectedPreset, setSelectedPreset] = useState<GrantPreset>(GRANT_PRESETS[0]);
  const [ttl, setTtl] = useState(4);
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleIssue() {
    setError(null);
    setIssuing(true);
    try {
      await grantsApi.issue(selectedPreset, ttl);
      onGrantChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setIssuing(false);
    }
  }

  async function handleRevoke() {
    if (!session?.grantId) return;
    setError(null);
    setRevoking(true);
    try {
      await grantsApi.revoke(session.grantId);
      onGrantChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setRevoking(false);
    }
  }

  const budgetPct = pct(session?.remainingDrops ?? null, session?.ceilingDrops ?? "1");  // ceilingDrops = PA-signed budgetMinor

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4 flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-widest">Fleet Manager</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          session?.revoked ? "bg-danger/20 text-danger"
            : session?.active ? "bg-green/20 text-green"
            : "bg-border text-muted"
        }`}>
          {session?.revoked ? "grant revoked" : session?.active ? "grant active" : "no grant"}
        </span>
      </div>

      {session?.active ? (
        <div className="space-y-3 flex-1">
          {/* Budget bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted">
              <span>Budget</span>
              <span className={budgetPct < 20 ? "text-warn" : "text-accent"}>
                {dropsToXrp(session.remainingDrops)} / {dropsToXrp(session.ceilingDrops)} XRP
              </span>
            </div>
            <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${budgetPct > 20 ? "bg-accent" : "bg-warn"}`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </div>

          {/* On-chain confirmed spend */}
          {session.onChainSpentDrops !== null && (
            <div className="flex justify-between text-xs">
              <span className="text-muted">On-chain confirmed</span>
              <span className={session.onChainSpentDrops === String(BigInt(session.ceilingDrops) - BigInt(session.remainingDrops ?? "0")) ? "text-green" : "text-warn"}>
                {dropsToXrp(session.onChainSpentDrops)} XRP ✓
              </span>
            </div>
          )}

          {/* Allowed purposes */}
          <div className="space-y-1">
            <p className="text-xs text-muted">Allowed Services</p>
            <div className="flex flex-wrap gap-1">
              {session.allowedPurposes.map((p) => (
                <span key={p} className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full border border-accent/20">
                  {p.replace("transport:", "")}
                </span>
              ))}
            </div>
          </div>

          {/* Grant ID */}
          {devView && session.grantId && (
            <div className="space-y-1">
              <p className="text-xs text-muted">Grant ID</p>
              <p className="font-mono text-xs text-muted truncate">{session.grantId}</p>
            </div>
          )}

          {/* Expires */}
          {session.expiresAt && (
            <p className="text-xs text-muted">
              Expires: {new Date(session.expiresAt).toLocaleTimeString()}
            </p>
          )}

          {session.revoked ? (
            <button
              onClick={handleIssue}
              disabled={issuing}
              className="w-full py-2 text-sm rounded bg-accent text-black font-semibold hover:bg-accent/80 disabled:opacity-40 transition-colors"
            >
              {issuing ? "Issuing…" : "Issue New Grant"}
            </button>
          ) : (
            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="w-full py-2 text-xs rounded border border-danger text-danger hover:bg-danger/10 disabled:opacity-40 transition-colors"
            >
              {revoking ? "Revoking…" : "Revoke Grant"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 flex-1">
          <p className="text-xs text-muted">Select a policy and issue a grant to the robotaxi.</p>

          {/* Preset selector */}
          <div className="space-y-2">
            {GRANT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setSelectedPreset(preset)}
                className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                  selectedPreset.id === preset.id
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-muted"
                }`}
              >
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-medium">{preset.label}</span>
                  <span className="text-xs text-muted">{preset.budgetXrp} XRP</span>
                </div>
                <p className="text-xs text-muted mt-0.5">{preset.description}</p>
              </button>
            ))}
          </div>

          {/* TTL */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted whitespace-nowrap">TTL (hrs)</label>
            <input
              type="number"
              min={1}
              max={24}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              className="flex-1 bg-surface border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-accent"
            />
          </div>

          <button
            onClick={handleIssue}
            disabled={issuing}
            className="w-full py-2 text-sm rounded bg-accent text-black font-semibold hover:bg-accent/80 disabled:opacity-40 transition-colors"
          >
            {issuing ? "Issuing…" : "Issue Grant"}
          </button>
        </div>
      )}

      {/* Gateway address */}
      {session?.gatewayAddress && (
        <div className="border-t border-border pt-3 space-y-1">
          <p className="text-xs text-muted">Gateway wallet</p>
          <p className="font-mono text-xs text-muted truncate">{session.gatewayAddress}</p>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
