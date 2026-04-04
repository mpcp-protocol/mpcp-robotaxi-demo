/**
 * Synthetic x402 merchant — returns 402 + X-Payment terms for mpcp-gateway proxy.
 * Second request (after gateway pays) includes x-payment-receipt → 200 OK.
 */
import { NextResponse } from "next/server";
import { MERCHANTS, getMerchantAddress, type MerchantType } from "@/lib/merchants";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ type: string }> },
): Promise<Response> {
  const { type } = await ctx.params;
  const merchant = MERCHANTS[type as MerchantType];
  if (!merchant) {
    return NextResponse.json({ error: "unknown_type" }, { status: 400 });
  }

  const receipt = _req.headers.get("x-payment-receipt");
  if (receipt) {
    return NextResponse.json({
      ok: true,
      paid: true,
      txRef: receipt,
      merchant: merchant.name,
    });
  }

  const drops = BigInt(merchant.amountDrops);
  const xPayment = JSON.stringify({
    amount: drops.toString(),
    currency: "XRP",
    address: getMerchantAddress(type as MerchantType),
  });

  return new NextResponse(JSON.stringify({ error: "payment_required", merchant: merchant.name }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-Payment": xPayment,
    },
  });
}
