/**
 * XRPL testnet client — connection, payment submission, tx lookup.
 */
import { Client, Wallet, type Payment } from "xrpl";
import {
  buildXrplMemo,
  type X402Challenge,
} from "x402-xrpl-settlement-adapter";

const WS_URL = "wss://s.altnet.rippletest.net:51233";
const EXPLORER = "https://testnet.xrpscan.com/tx";

let _client: Client | null = null;

export async function getClient(): Promise<Client> {
  if (!_client) _client = new Client(WS_URL);
  if (!_client.isConnected()) await _client.connect();
  return _client;
}

export function xrpScanUrl(txHash: string): string {
  return `${EXPLORER}/${txHash}`;
}

export function dropsToXrp(drops: string): string {
  const n = BigInt(drops);
  const whole = n / 1_000_000n;
  const frac  = n % 1_000_000n;
  if (frac === 0n) return String(whole);
  return `${whole}.${String(frac).padStart(6, "0").replace(/0+$/, "")}`;
}

export function xrpToDrops(xrp: string): string {
  const [intPart, fracPart = ""] = xrp.split(".");
  const padded = fracPart.padEnd(6, "0").slice(0, 6);
  return String(BigInt(intPart) * 1_000_000n + BigInt(padded));
}

/**
 * Sign and submit an XRPL Payment for an x402 challenge.
 * Returns the tx hash immediately (does not wait for validation).
 *
 * When grantId is provided it is written as a second Memo entry so that the
 * full spend history for a grant can be audited directly from the XRPL ledger
 * by querying transactions whose Memos contain the grantId value.
 */
export async function submitX402Payment(
  gatewaySeed: string,
  challenge: X402Challenge,
  grantId?: string | null,
): Promise<{ txHash: string; xrpScanUrl: string }> {
  const client  = await getClient();
  const wallet  = Wallet.fromSeed(gatewaySeed);
  const x402Memo = buildXrplMemo(challenge);

  // challenge.amount is XRP decimal ("1"), XRPL Amount field wants drops
  const amountDrops = xrpToDrops(challenge.amount);

  // XRPL Memo encoding: both MemoType and MemoData must be upper-case hex.
  const memos: unknown[] = [x402Memo];
  if (grantId) {
    memos.push({
      Memo: {
        MemoType: Buffer.from("mpcp/grant-id").toString("hex").toUpperCase(),
        MemoData: Buffer.from(grantId).toString("hex").toUpperCase(),
      },
    });
  }

  const payment: Payment = {
    TransactionType: "Payment",
    Account:         wallet.address,
    Destination:     challenge.destination,
    Amount:          amountDrops,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Memos:           memos as any,
  };

  const prepared = await client.autofill(payment);
  const { tx_blob, hash } = wallet.sign(prepared);

  // Submit without waiting for validation — we return the hash immediately
  // and the action route polls for confirmation separately.
  await client.submit(tx_blob);

  return { txHash: hash, xrpScanUrl: xrpScanUrl(hash) };
}

/**
 * Wait for a tx to be validated (polls up to ~10 s).
 */
export async function awaitValidation(txHash: string): Promise<boolean> {
  const client = await getClient();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await client.request({ command: "tx", transaction: txHash });
      if (res.result.validated) return true;
    } catch {
      // tx not yet indexed — keep polling
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

/**
 * Fetch a validated transaction for settlement verification.
 */
/** Returns XRP balance in drops, or "0" if account not found. */
export async function getXrpBalance(address: string): Promise<string> {
  const client = await getClient();
  try {
    const res = await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return String(((res.result.account_data as any) as Record<string, unknown>).Balance ?? "0");
  } catch {
    return "0";
  }
}

import type { FetchTransactionResult } from "x402-xrpl-settlement-adapter";

/**
 * Sum all confirmed XRPL payments from the gateway that carry a specific
 * grantId in their mpcp/grant-id Memo field.
 *
 * This provides an independent on-chain audit of total spend for a grant —
 * cross-check against the signer's in-memory counter to detect divergence.
 */
export async function queryOnChainSpend(
  gatewayAddress: string,
  grantId: string,
): Promise<string> {
  const client = await getClient();
  const grantIdHex = Buffer.from(grantId).toString("hex").toUpperCase();
  const memoTypeHex = Buffer.from("mpcp/grant-id").toString("hex").toUpperCase();

  let marker: unknown = undefined;
  let totalDrops = 0n;

  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await client.request({
      command: "account_tx",
      account: gatewayAddress,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 200,
      ...(marker ? { marker } : {}),
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (res as any).result as any;
    const txList: unknown[] = result.transactions ?? [];

    for (const entry of txList) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = entry as any;
      // xrpl.js v4 (API v2) nests fields under tx_json
      const tx = e.tx_json ?? e.tx ?? e;
      if (!tx || tx.TransactionType !== "Payment") continue;
      const memos: unknown[] = tx.Memos ?? [];
      for (const m of memos) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const memo = (m as any).Memo;
        if (memo?.MemoType === memoTypeHex && memo?.MemoData === grantIdHex) {
          const amount = tx.Amount ?? tx.DeliverMax;
          if (typeof amount === "string") totalDrops += BigInt(amount);
          break;
        }
      }
    }

    marker = result.marker;
  } while (marker);

  return String(totalDrops);
}

/**
 * Check if an XLS-70 grant credential exists on-ledger (liveness proof).
 * Returns true if the credential object is found, false if not (revoked/expired).
 */
export async function checkGrantCredentialLiveness(
  issuer: string,
  subject: string,
  grantId: string,
): Promise<boolean> {
  const client = await getClient();
  const credentialType = Buffer.from(`mpcp/grant:${grantId}`).toString("hex").toUpperCase();
  try {
    await client.request({
      command: "ledger_entry",
      credential: { subject, issuer, credentialType },
      ledger_index: "validated",
    } as any);
    return true;
  } catch {
    return false;
  }
}

export async function fetchTransaction(
  _network: string,
  txHash: string,
): Promise<FetchTransactionResult> {
  const client = await getClient();
  try {
    const res = await client.request({ command: "tx", transaction: txHash });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res.result as any as Record<string, unknown>;
    // xrpl.js v4 (API v2) nests transaction fields under tx_json — flatten for the adapter.
    // In API v2, Payment Amount is returned as DeliverMax; remap to Amount for the adapter.
    if (r.tx_json && typeof r.tx_json === "object") {
      const txj = r.tx_json as Record<string, unknown>;
      const flat: Record<string, unknown> = {
        ...txj,
        validated: r.validated,
        meta: r.meta,
      };
      if (flat.Amount === undefined && flat.DeliverMax !== undefined) {
        flat.Amount = flat.DeliverMax;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return flat as any as FetchTransactionResult;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return r as any as FetchTransactionResult;
  } catch {
    return null;
  }
}
