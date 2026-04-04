/**
 * Offline demo only: local SBA signing via @mpcp/agent (no Trust Gateway HTTP).
 * Online traffic uses mpcp-gateway-client + gateway proxy instead.
 */
import { createPrivateKey } from "node:crypto";
import { createSession, type Session } from "@mpcp/agent";

/**
 * Ephemeral agent session for offline robotaxi actions — signs SBAs locally.
 */
export async function createOfflineSigningSession(grant: unknown): Promise<Session> {
  const pem = process.env.MPCP_SBA_SIGNING_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  if (!pem) {
    throw new Error("MPCP_SBA_SIGNING_PRIVATE_KEY_PEM is not set (required for offline mode)");
  }

  const signingKey = createPrivateKey({ key: pem, format: "pem" });
  const gatewayAddress = process.env.XRPL_GATEWAY_ADDRESS ?? "";
  const paDomain = new URL(process.env.POLICY_AUTHORITY_URL ?? "http://localhost:3000").host;

  const g = grant as Record<string, unknown>;
  const inner = (g.grant && typeof g.grant === "object")
    ? (g.grant as Record<string, unknown>)
    : g;
  const ceiling = (inner.budgetMinor as string | undefined) ?? "0";

  return createSession(grant, {
    actorId:      gatewayAddress,
    issuer:       paDomain,
    signingKey,
    signingKeyId: process.env.MPCP_SBA_SIGNING_KEY_ID ?? "mpcp-sba-signing-key-1",
    scope:        "SESSION",
    ceiling:      { amount: ceiling, currency: "XRP" },
    skipRevocationCheck: false,
  });
}
