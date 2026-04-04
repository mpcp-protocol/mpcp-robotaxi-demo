/**
 * Merchant logic — shared between HTTP routes and the action orchestrator.
 */
import {
  createChallenge,
  verifySettlement,
  InMemoryReplayStore,
  type X402Challenge,
} from "x402-xrpl-settlement-adapter";
import { fetchTransaction } from "@/lib/xrpl";
import { MERCHANTS, getMerchantAddress, type MerchantType } from "@/lib/merchants";

// Per-merchant replay store (process-lifetime, demo quality)
const replayStores: Record<MerchantType, InMemoryReplayStore> = {
  toll:     new InMemoryReplayStore(),
  charging: new InMemoryReplayStore(),
  parking:  new InMemoryReplayStore(),
};

export async function getMerchantChallenge(
  type: MerchantType,
): Promise<{ challenge: X402Challenge; status: 402 }> {
  const merchant = MERCHANTS[type];
  const address  = getMerchantAddress(type);

  const challenge = createChallenge({
    network:     "xrpl:testnet",
    amount:      merchant.amountXrp,
    asset:       { kind: "XRP" },
    destination: address,
    expiresAt:   new Date(Date.now() + 60_000).toISOString(),
    paymentId:   crypto.randomUUID(),
  });

  return { challenge, status: 402 };
}

export async function verifyMerchantSettlement(
  type: MerchantType,
  challenge: X402Challenge,
  receiptHeaderValue: string,
): Promise<void> {
  await verifySettlement({
    challenge,
    receiptHeaderValue,
    fetchTransaction,
    replayStore: replayStores[type],
  });
}
