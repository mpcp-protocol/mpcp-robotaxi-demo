"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MERCHANTS, type MerchantType } from "@/lib/merchants";
import { merchantsApi, merchantControlsApi, type SessionState, type DemoEvent } from "@/lib/api";

interface Props {
  type: MerchantType;
  session: SessionState | null;
  devView: boolean;
}

type TerminalState = "idle" | "arriving" | "challenge" | "mpcp" | "signing" | "granted" | "denied";

function dropsToXrp(drops: string): string {
  return (Number(drops) / 1_000_000).toFixed(6).replace(/\.?0+$/, "") || "0";
}

export function MerchantTerminal({ type, session, devView }: Props) {
  const merchant = MERCHANTS[type];
  const [state, setTerminalState] = useState<TerminalState>("idle");
  const queryClient = useQueryClient();

  const { data: merchantInfoList } = useQuery({
    queryKey: ["merchants"],
    queryFn: merchantsApi.list,
    refetchInterval: 5_000,
  });
  const info = merchantInfoList?.find((m) => m.type === type);
  const networkStatus = info?.networkStatus ?? "online";
  const isOffline = networkStatus === "offline";

  const [lastEvent, setLastEvent] = useState<DemoEvent | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [xrpScanUrl, setXrpScanUrl] = useState<string | null>(null);
  const [robotaxiId, setRobotaxiId] = useState<string | null>(null);

  const isAllowed = session?.active && session.allowedPurposes.includes(merchant.purpose);

  const toggleNetwork = useMutation({
    mutationFn: () =>
      merchantControlsApi.setNetwork(type, isOffline ? "online" : "offline"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
    },
  });

  // Listen to SSE events
  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (e) => {
      const event: DemoEvent = JSON.parse(e.data);
      if (event.merchantType !== type && event.type !== "grant:issued" && event.type !== "grant:revoked") return;

      setLastEvent(event);

      switch (event.type) {
        case "robotaxi:arriving":
          setTerminalState("arriving");
          setRobotaxiId(event.robotaxiId ?? null);
          setTxHash(null);
          setXrpScanUrl(null);
          break;
        case "merchant:challenge":
          setTerminalState("challenge");
          break;
        case "mpcp:checking":
        case "mpcp:approved":
          setTerminalState("mpcp");
          break;
        case "xrpl:signing":
        case "xrpl:submitted":
        case "xrpl:confirmed":
          setTerminalState("signing");
          if (event.dev?.txHash) setTxHash(event.dev.txHash);
          if (event.dev?.xrpScanUrl) setXrpScanUrl(event.dev.xrpScanUrl);
          break;
        case "merchant:access_granted":
          setTerminalState("granted");
          break;
        case "mpcp:denied":
        case "merchant:access_denied":
          setTerminalState("denied");
          break;
        case "grant:issued":
        case "grant:revoked":
          setTerminalState("idle");
          setTxHash(null);
          break;
      }
    };

    return () => es.close();
  }, [type]);

  // Auto-reset after granted/denied
  useEffect(() => {
    if (state === "granted" || state === "denied") {
      const t = setTimeout(() => setTerminalState("idle"), 6_000);
      return () => clearTimeout(t);
    }
  }, [state]);

  const stateColor = {
    idle: "border-border",
    arriving: "border-accent",
    challenge: "border-warn",
    mpcp: "border-accent",
    signing: "border-accent",
    granted: "border-green",
    denied: "border-danger",
  }[state];

  const stateLabel = {
    idle: "Idle",
    arriving: "Vehicle arriving…",
    challenge: "Issuing 402…",
    mpcp: "MPCP checking…",
    signing: "Signing tx…",
    granted: isOffline ? "Granted (offline — SBA)" : "Access granted ✓",
    denied: "Access denied ✗",
  }[state];

  return (
    <div className={`bg-card border-2 ${stateColor} rounded-xl p-4 space-y-3 transition-colors`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{merchant.emoji}</span>
          <div>
            <p className="font-semibold text-sm">{merchant.name}</p>
            <p className="text-xs text-muted">{merchant.amountXrp} XRP / visit</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          isAllowed ? "bg-green/10 text-green" : "bg-danger/10 text-danger"
        }`}>
          {isAllowed ? "allowed" : "blocked"}
        </span>
      </div>

      {/* Status display */}
      <div className={`rounded-lg p-3 text-center min-h-[80px] flex flex-col items-center justify-center gap-2 ${
        state === "idle" ? "bg-surface" :
        state === "granted" ? "bg-green/5 border border-green/20" :
        state === "denied" ? "bg-danger/5 border border-danger/20" :
        "bg-accent/5 border border-accent/20"
      }`}>
        {state === "idle" ? (
          <p className="text-xs text-muted">Awaiting vehicle…</p>
        ) : (
          <>
            {state === "arriving" && <span className="text-3xl animate-bounce">🚕</span>}
            {state === "granted" && <span className="text-3xl">{isOffline ? "📵" : "✅"}</span>}
            {state === "denied" && <span className="text-3xl">🚫</span>}
            <p className={`text-xs font-medium ${
              state === "granted" ? "text-green" :
              state === "denied" ? "text-danger" :
              "text-accent"
            }`}>{stateLabel}</p>
            {robotaxiId && (
              <p className="font-mono text-xs text-muted">{robotaxiId}</p>
            )}
          </>
        )}
      </div>

      {/* Tx hash (dev or granted state — online only) */}
      {txHash && (state === "signing" || state === "granted") && !isOffline && (
        <div className="space-y-1">
          <p className="text-xs text-muted">XRPL tx</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-accent truncate">{txHash.slice(0, 16)}…</span>
            {xrpScanUrl && (
              <a href={xrpScanUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-muted hover:text-accent shrink-0">
                ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* Dev view — raw event payload */}
      {devView && lastEvent?.dev && (
        <details className="text-xs">
          <summary className="text-muted cursor-pointer">Dev payload</summary>
          <pre className="mt-1 p-2 bg-surface rounded text-muted overflow-auto max-h-32 text-[10px]">
            {JSON.stringify(lastEvent.dev, null, 2)}
          </pre>
        </details>
      )}

      {/* Purpose + wallet */}
      <div className="border-t border-border pt-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-muted">{merchant.purpose}</span>
          {/* Network toggle */}
          <button
            onClick={() => toggleNetwork.mutate()}
            disabled={toggleNetwork.isPending}
            className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors ${
              isOffline
                ? "border-warn/40 bg-warn/10 text-warn hover:bg-warn/20"
                : "border-border text-muted hover:text-white hover:border-muted"
            }`}
            title={
              isOffline
                ? `Click to bring online\n${info?.bundleCount ?? 0} trust bundle(s) cached`
                : "Click to simulate offline — trust bundle will be pre-downloaded"
            }
          >
            <span>{isOffline ? "📵" : "📡"}</span>
            <span>{isOffline ? "offline" : "online"}</span>
          </button>
        </div>
        {/* Trust bundle cache + pending settlements indicator (offline only) */}
        {isOffline && (
          <div className="space-y-0.5">
            <p className="text-[10px] text-warn/80 font-mono">
              {(info?.bundleCount ?? 0) > 0
                ? `trust bundle cached (${info?.bundleCount} bundle${(info?.bundleCount ?? 0) !== 1 ? "s" : ""})`
                : "no trust bundle cached"}
            </p>
            {(info?.pendingCount ?? 0) > 0 && (
              <p className="text-[10px] text-accent font-mono">
                {info!.pendingCount} pending settlement{info!.pendingCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}
        {info?.address && (
          <div className="flex justify-between items-center">
            <span className="font-mono text-xs text-muted truncate max-w-[140px]">{info.address}</span>
            <span className="text-xs text-accent shrink-0 ml-2">{dropsToXrp(info.balance)} XRP</span>
          </div>
        )}
      </div>
    </div>
  );
}
