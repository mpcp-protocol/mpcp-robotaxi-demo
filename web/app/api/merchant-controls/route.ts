import { NextRequest, NextResponse } from "next/server";
import {
  getAllMerchantNetworkStatus,
  setMerchantNetworkStatus,
  getMerchantNetworkInfo,
  type NetworkStatus,
} from "@/lib/merchant-network";
import type { MerchantType } from "@/lib/merchants";

export async function GET() {
  return NextResponse.json({
    toll:     getMerchantNetworkInfo("toll"),
    charging: getMerchantNetworkInfo("charging"),
    parking:  getMerchantNetworkInfo("parking"),
  });
}

export async function POST(req: NextRequest) {
  const { type, status }: { type: MerchantType; status: NetworkStatus } = await req.json();
  if (!type || !["online", "offline"].includes(status)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const result = await setMerchantNetworkStatus(type, status);

  if (!result.ok) {
    return NextResponse.json(
      { error: "offline_refused", message: result.error },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, type, status, bundleCount: result.bundleCount });
}
