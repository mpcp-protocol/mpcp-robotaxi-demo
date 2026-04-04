"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FleetPanel } from "@/components/FleetPanel";
import { MerchantTerminal } from "@/components/MerchantTerminal";
import { RobotaxiPanel } from "@/components/RobotaxiPanel";
import { EventFeed } from "@/components/EventFeed";
import { sessionApi, type SessionState } from "@/lib/api";

export default function Home() {
  const [devView, setDevView] = useState(false);

  const { data: session, refetch: refetchSession } = useQuery<SessionState>({
    queryKey: ["session"],
    queryFn: sessionApi.get,
    refetchInterval: 3_000,
  });

  return (
    <div className="min-h-screen bg-bg text-white">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚕</span>
          <div>
            <h1 className="font-bold text-white tracking-tight">MPCP Robotaxi Demo</h1>
            <p className="text-xs text-muted">Autonomous fleet · XRPL Testnet · Machine Payment Control Protocol</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://testnet.xrpscan.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted hover:text-accent transition-colors"
          >
            XRPScan ↗
          </a>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-muted">Dev View</span>
            <button
              onClick={() => setDevView(!devView)}
              className={`w-10 h-5 rounded-full transition-colors relative ${devView ? "bg-accent" : "bg-border"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${devView ? "left-5" : "left-0.5"}`} />
            </button>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-xs text-muted">XRPL Testnet</span>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-[1400px] mx-auto">
        {/* Top row: Fleet Manager + Merchant Terminals */}
        <div className="grid grid-cols-[280px_1fr] gap-4">
          <FleetPanel session={session ?? null} onGrantChange={refetchSession} devView={devView} />

          <div className="grid grid-cols-3 gap-4">
            {(["toll", "charging", "parking"] as const).map((type) => (
              <MerchantTerminal key={type} type={type} session={session ?? null} devView={devView} />
            ))}
          </div>
        </div>

        {/* Robotaxi action bar */}
        <RobotaxiPanel session={session ?? null} onAction={refetchSession} />

        {/* Event feed */}
        <EventFeed devView={devView} />
      </div>
    </div>
  );
}
