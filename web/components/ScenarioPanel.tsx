"use client";
import { useEffect, useState } from "react";
import { demoApi } from "@/lib/api";

export function ScenarioPanel() {
  const [paRunning, setPaRunning] = useState<boolean | null>(null);
  const [paLoading, setPaLoading] = useState(false);
  const [agentMode, setAgentMode] = useState<"honest" | "malicious">("honest");
  const [modeLoading, setModeLoading] = useState(false);

  // Poll PA health
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const { running } = await demoApi.getPaStatus();
        if (active) setPaRunning(running);
      } catch {
        if (active) setPaRunning(null);
      }
    }
    poll();
    const id = setInterval(poll, 4_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Fetch initial agent mode
  useEffect(() => {
    demoApi.getAgentMode().then(({ mode }) => setAgentMode(mode)).catch(() => {});
  }, []);

  async function togglePa() {
    setPaLoading(true);
    try {
      const action = paRunning ? "stop" : "start";
      await demoApi.setPa(action);
      if (action === "stop") {
        setPaRunning(false);
        setPaLoading(false);
      } else {
        // Poll quickly until PA is up (client-side, doesn't block server)
        let found = false;
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 700));
          try {
            const { running } = await demoApi.getPaStatus();
            if (running) { setPaRunning(true); found = true; break; }
          } catch { /* keep polling */ }
        }
        if (!found) setPaRunning(false);
        setPaLoading(false);
      }
    } catch {
      setPaLoading(false);
    }
  }

  async function toggleAgentMode() {
    setModeLoading(true);
    const next = agentMode === "honest" ? "malicious" : "honest";
    try {
      await demoApi.setAgentMode(next);
      setAgentMode(next);
    } catch { /* ignore */ }
    finally { setModeLoading(false); }
  }

  const isMalicious = agentMode === "malicious";

  return (
    <div className={`bg-card border rounded-xl p-4 transition-colors ${
      isMalicious ? "border-danger/60" : "border-border"
    }`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-widest">
          Scenario Controls
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* PA control */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${
              paRunning === null ? "bg-border" :
              paRunning ? "bg-green animate-pulse" : "bg-danger"
            }`} />
            <div>
              <p className="text-sm font-medium text-white">Policy Authority</p>
              <p className="text-xs text-muted">
                {paRunning === null ? "Checking…" : paRunning ? "Running on :3000" : "Stopped"}
              </p>
            </div>
          </div>
          <button
            onClick={togglePa}
            disabled={paLoading}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40 ${
              paRunning
                ? "border border-danger text-danger hover:bg-danger/10"
                : "border border-green text-green hover:bg-green/10"
            }`}
          >
            {paLoading ? "…" : paRunning ? "Stop" : "Start"}
          </button>
        </div>

        {/* Agent integrity */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${
              isMalicious ? "bg-danger animate-pulse" : "bg-green"
            }`} />
            <div>
              <p className="text-sm font-medium text-white">Agent Integrity</p>
              <p className={`text-xs ${isMalicious ? "text-danger" : "text-muted"}`}>
                {isMalicious ? "Compromised — bypassing policy checks" : "Honest — all checks active"}
              </p>
            </div>
          </div>
          <button
            onClick={toggleAgentMode}
            disabled={modeLoading}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40 ${
              isMalicious
                ? "border border-green text-green hover:bg-green/10"
                : "border border-danger text-danger hover:bg-danger/10"
            }`}
          >
            {modeLoading ? "…" : isMalicious ? "Restore" : "Compromise"}
          </button>
        </div>
      </div>
    </div>
  );
}
