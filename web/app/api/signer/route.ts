/**
 * XRPL payment signer service.
 *
 * The agent POSTs { sba, challenge } here after MPCP session check passes.
 * This route independently verifies the SBA and enforces its own spend counter,
 * then signs and submits the XRPL Payment transaction.
 *
 * The robotaxi agent has no access to XRPL_GATEWAY_SEED.
 */
import { NextRequest, NextResponse } from "next/server";
import { signerState } from "@/lib/signer-state";
import { verifySba } from "@/lib/verify-sba";
import { submitX402Payment } from "@/lib/xrpl";
import { encodeReceiptHeader, type X402Challenge } from "x402-xrpl-settlement-adapter";

const GATEWAY_SEED = process.env.XRPL_GATEWAY_SEED;

export async function POST(req: NextRequest) {
  if (!GATEWAY_SEED) {
    return NextResponse.json({ error: "signer_not_configured", message: "XRPL_GATEWAY_SEED not set" }, { status: 503 });
  }

  if (!signerState.hasGrant()) {
    return NextResponse.json({ error: "no_grant", message: "No active grant in signer" }, { status: 403 });
  }

  let body: { sba: string; challenge: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const challenge = body.challenge as X402Challenge;
  const amountDrops = BigInt(challenge.amount.includes(".")
    ? String(Math.round(parseFloat(challenge.amount) * 1_000_000))
    : challenge.amount + "000000"
  );
  // More precise: challenge.amount is XRP decimal, convert to drops
  // e.g. "1" → 1000000, "5" → 5000000
  const [intPart, fracPart = ""] = challenge.amount.split(".");
  const drops = BigInt(intPart) * 1_000_000n + BigInt(fracPart.padEnd(6, "0").slice(0, 6));

  // ── 1. Decode and verify SBA ────────────────────────────────────────────────
  let sbaJson: unknown;
  try {
    sbaJson = JSON.parse(Buffer.from(body.sba, "base64").toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "sba_invalid", message: "Cannot decode SBA" }, { status: 400 });
  }

  const sbaResult = await verifySba(sbaJson, drops);
  if (!sbaResult.ok) {
    return NextResponse.json({ error: "sba_invalid", message: sbaResult.reason }, { status: 403 });
  }

  // ── 1b. Gateway authorization check ─────────────────────────────────────
  const authorizedGw = signerState.getAuthorizedGateway();
  const ownAddress   = process.env.XRPL_GATEWAY_ADDRESS ?? "";
  if (authorizedGw && ownAddress && authorizedGw !== ownAddress) {
    return NextResponse.json({
      error: "unauthorized_gateway",
      message: `Grant is bound to gateway ${authorizedGw}, this signer is ${ownAddress}`,
    }, { status: 403 });
  }

  // ── 2. Independent spend check ───────────────────────────────────────────────
  if (!signerState.trySpend(drops)) {
    return NextResponse.json({
      error: "budget_exceeded",
      message: `Signer ceiling exceeded. Remaining: ${signerState.getRemaining()} drops.`,
    }, { status: 402 });
  }

  // ── 3. Sign and submit XRPL Payment ─────────────────────────────────────────
  try {
    const { txHash, xrpScanUrl } = await submitX402Payment(GATEWAY_SEED, challenge, signerState.getGrantId());
    const receiptHeader = encodeReceiptHeader({
      network: challenge.network,
      txHash,
      paymentId: challenge.paymentId,
    });
    return NextResponse.json({ receiptHeader, txHash, xrpScanUrl });
  } catch (err) {
    signerState.trySpend(-drops);
    // Serialize XRPL errors which may have non-enumerable properties
    let msg: string;
    if (err instanceof Error) {
      msg = err.message || err.constructor.name;
    } else if (err && typeof err === "object") {
      const allKeys = Object.getOwnPropertyNames(err);
      const extracted: Record<string, unknown> = {};
      for (const k of allKeys) extracted[k] = (err as Record<string, unknown>)[k];
      msg = JSON.stringify(extracted);
    } else {
      msg = String(err);
    }
    console.error("[signer] XRPL error:", msg, err);
    return NextResponse.json({ error: "signing_failed", message: msg }, { status: 500 });
  }
}
