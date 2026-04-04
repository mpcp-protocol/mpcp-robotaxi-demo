/**
 * Trigger a robotaxi action (toll, charging, parking).
 *
 * Online: Trust Gateway session.fetch → synthetic merchant 402 → gateway pays → access.
 * Offline: local @mpcp/agent SBA + Trust Bundle verification (no gateway HTTP).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getActiveSession,
  getAllowedPurposes,
  getGrantForVerification,
  hasGrant,
} from "@/lib/agent-session";
import { broadcast } from "@/lib/events";
import { MERCHANTS, type MerchantType } from "@/lib/merchants";
import { getMerchantChallenge } from "@/lib/merchant-handlers";
import {
  getMerchantNetworkStatus,
  getCachedTrustBundles,
  queuePendingSettlement,
} from "@/lib/merchant-network";
import { verifySbaOffline } from "@/lib/verify-sba";
import { createOfflineSigningSession } from "@/lib/offline-agent";
import {
  GatewayBudgetExceededError,
  GatewayGrantRevokedError,
  GatewayInternalError,
  GatewayMerchantError,
  GatewayPurposeError,
  GatewayVelocityError,
} from "mpcp-gateway-client";

const ROBOTAXI_ID = process.env.ROBOTAXI_ID ?? "TX-001";
const NEXT_URL    = process.env.AGENT_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  const { type }: { type: MerchantType } = await req.json();
  const merchant = MERCHANTS[type];
  if (!merchant) {
    return NextResponse.json({ error: "unknown_type" }, { status: 400 });
  }

  if (!hasGrant()) {
    return NextResponse.json({ ok: false, denied: true, deniedReason: "No active grant — issue one first." });
  }

  broadcast("robotaxi:arriving", `${ROBOTAXI_ID} arriving at ${merchant.name}`, {
    merchantType: type,
    robotaxiId: ROBOTAXI_ID,
  });

  const allowed = getAllowedPurposes();
  if (!allowed.includes(merchant.purpose)) {
    broadcast("mpcp:denied",
      `MPCP blocked: ${merchant.purpose} not in allowedPurposes [${allowed.join(", ")}]`,
      { merchantType: type, robotaxiId: ROBOTAXI_ID });
    return NextResponse.json({
      ok: false, denied: true,
      deniedReason: `Policy denies ${merchant.purpose}. Allowed: [${allowed.join(", ")}]`,
    });
  }

  const networkStatus = getMerchantNetworkStatus(type);

  // ── Offline: local SBA + Trust Bundle (legacy agent path) ─────────────────
  if (networkStatus === "offline") {
    const { challenge } = await getMerchantChallenge(type);
    broadcast("merchant:challenge", `${merchant.name} issued x402 challenge: ${merchant.amountXrp} XRP`, {
      merchantType: type, robotaxiId: ROBOTAXI_ID,
    });

    broadcast("mpcp:checking", "MPCP session verifying budget and grant…", {
      merchantType: type, robotaxiId: ROBOTAXI_ID,
    });

    let sba: unknown;
    try {
      const grant = getGrantForVerification();
      const offlineSession = await createOfflineSigningSession(grant);
      sba = await offlineSession.createSba({
        amount: merchant.amountDrops,
        currency: "XRP",
        rail: "xrpl",
      });
    } catch (err) {
      const msg = String(err);
      const isBudget = msg.includes("budget") || msg.includes("Budget");
      broadcast("mpcp:denied", isBudget ? "MPCP budget ceiling reached" : `MPCP denied: ${msg}`, {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
        dev: { rawError: msg },
      });
      return NextResponse.json({ ok: false, denied: true, deniedReason: msg });
    }

    broadcast("mpcp:approved", `MPCP approved — SBA signed for ${merchant.amountXrp} XRP`, {
      merchantType: type, robotaxiId: ROBOTAXI_ID,
      dev: { sba, challenge },
    });

    const trustBundles = getCachedTrustBundles(type);
    const grant = getGrantForVerification();

    broadcast("mpcp:checking",
      `${merchant.name} (offline) verifying SBA + PolicyGrant via Trust Bundle…`, {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
        dev: { offlineMode: true, bundleCount: trustBundles.length, verificationLevel: "signature-only" as const },
      });

    const verifyResult = await verifySbaOffline(
      sba,
      grant,
      BigInt(merchant.amountDrops),
      trustBundles,
    );

    if (!verifyResult.ok) {
      broadcast("merchant:access_denied",
        `${merchant.name} (offline) — verification failed: ${verifyResult.reason}`, {
          merchantType: type, robotaxiId: ROBOTAXI_ID,
          dev: { offlineMode: true, rawError: verifyResult.reason },
        });
      return NextResponse.json({
        ok: false, denied: true,
        deniedReason: `Offline verification failed: ${verifyResult.reason}`,
      });
    }

    queuePendingSettlement(type, sba, challenge, merchant.amountXrp);

    broadcast("merchant:access_granted",
      `${merchant.name} — offline access granted (SBA + PolicyGrant verified via Trust Bundle, settlement deferred)`, {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
        dev: { offlineMode: true, sba, verificationLevel: "signature-only" as const },
      });
    return NextResponse.json({
      ok: true,
      message: "Access granted (offline — Trust Bundle verification, settlement deferred)",
      offlineMode: true,
    });
  }

  // ── Online: Trust Gateway proxy ───────────────────────────────────────────
  broadcast("merchant:challenge", `${merchant.name} — payment via Trust Gateway`, {
    merchantType: type, robotaxiId: ROBOTAXI_ID,
  });

  broadcast("mpcp:checking", "Trust Gateway session paying merchant…", {
    merchantType: type, robotaxiId: ROBOTAXI_ID,
  });

  const merchantUrl = `${NEXT_URL}/api/merchant-x402/${type}`;

  try {
    const session = await getActiveSession();
    const res = await session.fetch(merchantUrl, {
      purpose: merchant.purpose,
      method:  "POST",
    });

    if (!res.ok) {
      const body = await res.text();
      broadcast("error", `Gateway proxy failed: HTTP ${res.status}`, {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
        dev: { rawError: body.slice(0, 500) },
      });
      return NextResponse.json({
        ok: false,
        denied: false,
        message: `Gateway returned ${res.status}: ${body.slice(0, 200)}`,
      });
    }

    const payload = await res.json().catch(() => ({})) as { txRef?: string; paid?: boolean };
    const txRef = payload.txRef;
    const isRealHash = txRef && /^[A-F0-9]{64}$/i.test(txRef);

    broadcast("mpcp:approved", `Trust Gateway paid ${merchant.name}`, {
      merchantType: type, robotaxiId: ROBOTAXI_ID,
      dev: {
        txHash: txRef,
        ...(isRealHash ? { xrpScanUrl: `https://testnet.xrpscan.com/tx/${txRef}` } : {}),
      },
    });

    broadcast("merchant:access_granted", `${merchant.name} — access granted ✓`, {
      merchantType: type, robotaxiId: ROBOTAXI_ID,
    });

    return NextResponse.json({
      ok: true,
      message: "Access granted (Trust Gateway)",
      txRef: payload.txRef,
      gatewayProxy: true,
    });
  } catch (err) {
    if (err instanceof GatewayBudgetExceededError) {
      broadcast("mpcp:denied", "MPCP budget ceiling reached", {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
      });
      return NextResponse.json({ ok: false, denied: true, deniedReason: err.message });
    }
    if (err instanceof GatewayGrantRevokedError) {
      broadcast("mpcp:denied", "Grant revoked or expired", {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
      });
      return NextResponse.json({ ok: false, denied: true, deniedReason: err.message });
    }
    if (err instanceof GatewayPurposeError) {
      broadcast("mpcp:denied", `Purpose not allowed: ${err.message}`, {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
      });
      return NextResponse.json({ ok: false, denied: true, deniedReason: err.message });
    }
    if (err instanceof GatewayMerchantError) {
      broadcast("mpcp:denied", `Merchant blocked: ${err.reason}`, {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
      });
      return NextResponse.json({ ok: false, denied: true, deniedReason: err.message });
    }
    if (err instanceof GatewayVelocityError) {
      broadcast("mpcp:denied", "Velocity limit", {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
      });
      return NextResponse.json({ ok: false, denied: true, deniedReason: err.message });
    }
    if (err instanceof GatewayInternalError) {
      broadcast("error", `Gateway internal: ${err.message}`, {
        merchantType: type, robotaxiId: ROBOTAXI_ID,
      });
      return NextResponse.json({ ok: false, message: err.message });
    }

    const msg = String(err);
    broadcast("mpcp:denied", `MPCP / gateway error: ${msg}`, {
      merchantType: type, robotaxiId: ROBOTAXI_ID,
    });
    return NextResponse.json({ ok: false, denied: true, deniedReason: msg });
  }
}
