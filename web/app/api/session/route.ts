import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/agent-session";
import { queryOnChainSpend } from "@/lib/xrpl";

const GATEWAY_ADDRESS = process.env.XRPL_GATEWAY_ADDRESS ?? "";

export async function GET() {
  try {
    const state = await getSessionState();

    if (state.active && state.grantId && GATEWAY_ADDRESS) {
      try {
        const onChainSpentDrops = await Promise.race([
          queryOnChainSpend(GATEWAY_ADDRESS, state.grantId),
          new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
        ]);
        return NextResponse.json({ ...state, onChainSpentDrops });
      } catch {
        return NextResponse.json({ ...state, onChainSpentDrops: null });
      }
    }

    return NextResponse.json(state);
  } catch {
    // Never return 500 — the FleetPanel relies on 200 to preserve grant state.
    return NextResponse.json({ active: false, remainingDrops: null });
  }
}
