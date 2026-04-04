import { NextResponse } from "next/server";
import { getXrpBalance } from "@/lib/xrpl";
import { getMerchantAddress, MERCHANTS, type MerchantType } from "@/lib/merchants";
import { getMerchantNetworkInfo } from "@/lib/merchant-network";

export async function GET() {
  const types: MerchantType[] = ["toll", "charging", "parking"];
  const results = await Promise.all(
    types.map(async (type) => {
      let address = "";
      let balance = "0";
      try {
        address = getMerchantAddress(type);
        balance = await getXrpBalance(address);
      } catch {
        // env var not set — skip
      }
      const netInfo = getMerchantNetworkInfo(type);
      return {
        ...MERCHANTS[type],
        address,
        balance,
        networkStatus:   netInfo.status,
        bundlesCachedAt: netInfo.bundlesCachedAt,
        bundleCount:     netInfo.bundleCount,
        pendingCount:    netInfo.pendingCount,
      };
    }),
  );
  return NextResponse.json(results);
}
