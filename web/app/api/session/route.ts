import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/agent-session";
import { queryOnChainSpend } from "@/lib/xrpl";

const GATEWAY_ADDRESS = process.env.XRPL_GATEWAY_ADDRESS ?? "";

export async function GET() {
  try {
    const state = await getSessionState();

    // Augment with on-chain spend audit when a grant is active and gateway is configured.
    if (state.active && state.grantId && GATEWAY_ADDRESS) {
      try {
        const onChainSpentDrops = await queryOnChainSpend(GATEWAY_ADDRESS, state.grantId);
        return NextResponse.json({ ...state, onChainSpentDrops });
      } catch {
        // XRPL unavailable — return null gracefully, do not block UI
        return NextResponse.json({ ...state, onChainSpentDrops: null });
      }
    }

    return NextResponse.json(state);
  } catch {
    return NextResponse.json({ active: false, error: "session_error" }, { status: 500 });
  }
}
