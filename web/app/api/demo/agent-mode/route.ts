import { NextRequest, NextResponse } from "next/server";
import { getAgentMode, setAgentMode } from "@/lib/demo-controls";
import { broadcast } from "@/lib/events";

export async function GET() {
  return NextResponse.json({ mode: getAgentMode() });
}

export async function POST(req: NextRequest) {
  const { mode }: { mode: "honest" | "malicious" } = await req.json();
  if (mode !== "honest" && mode !== "malicious") {
    return NextResponse.json({ error: "mode must be 'honest' or 'malicious'" }, { status: 400 });
  }
  const prev = getAgentMode();
  setAgentMode(mode);
  if (prev !== mode) {
    broadcast("agent:override", mode === "malicious"
      ? "Agent compromised — policy checks disabled"
      : "Agent integrity restored — policy checks re-enabled");
  }
  return NextResponse.json({ mode });
}
