"use client";
import { useEffect, useRef, useState } from "react";
import type { DemoEvent } from "@/lib/api";

interface Props { devView: boolean; }

const EVENT_COLORS: Record<string, string> = {
  "robotaxi:arriving":       "text-accent",
  "merchant:challenge":      "text-warn",
  "mpcp:checking":           "text-muted",
  "mpcp:approved":           "text-green",
  "mpcp:denied":             "text-danger",
  "xrpl:signing":            "text-accent",
  "xrpl:submitted":          "text-accent",
  "xrpl:confirmed":          "text-green",
  "merchant:access_granted": "text-green",
  "merchant:access_denied":  "text-danger",
  "grant:issued":            "text-green",
  "grant:revoked":           "text-warn",
  "infra:pa_stopped":        "text-warn",
  "infra:pa_started":        "text-green",
  "agent:override":          "text-warn",
  "error":                   "text-danger",
};

const MERCHANT_EMOJI: Record<string, string> = {
  toll: "🛣️", charging: "⚡", parking: "🔧",
};

const DEV_ARTIFACT_LABELS: Record<string, string> = {
  grant:     "Grant Envelope",
  policy:    "Policy Document",
  sba:       "Signed Budget Authorization",
  challenge: "Merchant Challenge",
};

const INLINE_DEV_KEYS = new Set(["txHash", "xrpScanUrl", "rawError", "offlineMode", "bundleCount", "verificationLevel"]);

function DevArtifacts({ dev }: { dev: NonNullable<DemoEvent["dev"]> }) {
  const artifacts = Object.entries(dev).filter(
    ([k, v]) => v != null && !INLINE_DEV_KEYS.has(k),
  );
  if (artifacts.length === 0) return null;

  return (
    <div className="mt-1 ml-[7.5ch] space-y-1">
      {artifacts.map(([key, value]) => (
        <details key={key} className="group/artifact">
          <summary className="cursor-pointer text-[10px] text-muted hover:text-white select-none">
            <span className="ml-1">{DEV_ARTIFACT_LABELS[key] ?? key}</span>
          </summary>
          <pre className="mt-0.5 p-2 rounded bg-black/40 text-[10px] text-muted leading-relaxed overflow-x-auto max-h-48 overflow-y-auto">
            {JSON.stringify(value, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}

export function EventFeed({ devView }: Props) {
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = JSON.parse(e.data);
      if (raw.type === "connected") return;
      const event: DemoEvent = raw as DemoEvent;
      setEvents((prev) => [...prev.slice(-99), event]);
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-widest">Live Event Feed</h2>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <button onClick={() => setEvents([])} className="text-xs text-muted hover:text-white">
              clear
            </button>
          )}
          <span className="text-xs text-muted">{events.length} events</span>
        </div>
      </div>

      <div className="h-48 overflow-y-auto p-3 space-y-1 font-mono text-xs">
        {events.length === 0 ? (
          <p className="text-muted text-center py-8">Events will appear here as the demo runs…</p>
        ) : (
          events.map((event) => (
            <div key={event.id}>
              <div className="flex items-start gap-2 group">
                <span className="text-muted shrink-0 tabular-nums">
                  {new Date(event.timestamp).toLocaleTimeString("en", { hour12: false })}
                </span>
                {event.merchantType && (
                  <span className="shrink-0">{MERCHANT_EMOJI[event.merchantType] ?? ""}</span>
                )}
                <span className={`${EVENT_COLORS[event.type] ?? "text-white"} flex-1`}>
                  {event.message}
                  {event.dev?.txHash && (
                    <a
                      href={event.dev.xrpScanUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-accent hover:underline"
                      title={event.dev.txHash as string}
                    >
                      {event.dev.txHash as string} ↗
                    </a>
                  )}
                </span>
                {devView && event.dev?.rawError && (
                  <span className="text-danger text-[10px] shrink-0">{(event.dev.rawError as string).slice(0, 60)}</span>
                )}
              </div>
              {devView && event.dev && <DevArtifacts dev={event.dev} />}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
