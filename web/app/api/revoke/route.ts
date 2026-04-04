import { NextRequest, NextResponse } from "next/server";
import { signerState } from "@/lib/signer-state";
import { revokeGrant } from "@/lib/agent-session";
import { ensurePaReady, PaBootstrapError } from "@/lib/pa-bootstrap";
import { broadcast } from "@/lib/events";
import { xrpScanUrl } from "@/lib/xrpl";

const PA_URL = process.env.POLICY_AUTHORITY_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  const { grantId }: { grantId: string } = await req.json();

  let paKey: string;
  try {
    ({ paKey } = await ensurePaReady());
  } catch (err) {
    const msg = err instanceof PaBootstrapError ? err.message : String(err);
    return NextResponse.json({ error: "pa_bootstrap_failed", message: msg }, { status: 503 });
  }

  const res = await fetch(`${PA_URL}/revoke`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${paKey}` },
    body:    JSON.stringify({ grantId }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `PA error ${res.status}: ${err}` }, { status: 502 });
  }

  const paResponse = await res.json() as Record<string, unknown>;
  const credentialTxHash = paResponse.credentialTxHash as string | undefined;

  signerState.clearGrant();
  await revokeGrant();

  const isRealHash = credentialTxHash && /^[A-F0-9]{64}$/i.test(credentialTxHash);

  broadcast("grant:revoked", `Grant revoked — ${grantId}`, {
    dev: {
      ...(credentialTxHash ? { txHash: credentialTxHash } : {}),
      ...(isRealHash ? { xrpScanUrl: xrpScanUrl(credentialTxHash) } : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    credentialTxHash,
  });
}
