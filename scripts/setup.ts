/**
 * One-time setup: generates MPCP keys + XRPL wallets, funds them from
 * the XRPL testnet faucet, and writes everything to web/.env.
 *
 *   npm run setup
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { Wallet } from "xrpl";

const ROOT    = resolve(import.meta.dirname, "..");
const WEB_ENV = resolve(ROOT, "web/.env");
const WEB_EXAMPLE = resolve(ROOT, "web/.env.example");
const PA_ENV  = resolve(ROOT, "../mpcp-policy-authority/.env");

// ── Generate MPCP SBA key pair ────────────────────────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding:  { type: "spki",  format: "pem" },
});

const privPem = (privateKey as string).trim().replace(/\n/g, "\\n");
const pubPem  = (publicKey  as string).trim().replace(/\n/g, "\\n");

// ── Generate XRPL wallets ─────────────────────────────────────────────────────

const gateway  = Wallet.generate();
const toll     = Wallet.generate();
const charging = Wallet.generate();
const parking  = Wallet.generate();
const paIssuer = Wallet.generate();

const paAdminKey = randomBytes(32).toString("hex");

// ── Fund wallets from XRPL testnet faucet ────────────────────────────────────

async function fundWallet(address: string, label: string): Promise<void> {
  process.stdout.write(`  Funding ${label} (${address})… `);
  const res = await fetch("https://faucet.altnet.rippletest.net/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination: address, userAgent: "mpcp-robotaxi" }),
  });
  if (!res.ok) {
    console.log(`FAILED (HTTP ${res.status})`);
    return;
  }
  const data = await res.json() as { account?: { balance?: string } };
  console.log(`✓ balance: ${data.account?.balance ?? "?"} drops`);
}

// ── Preview ───────────────────────────────────────────────────────────────────

const LINE = "─".repeat(64);

console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
console.log(`║            mpcp-robotaxi — setup                                ║`);
console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);

console.log(`${LINE}\n  MPCP SBA key pair\n${LINE}`);
console.log(`  Private: ${privPem.slice(0, 40)}…`);
console.log(`  Public:  ${pubPem.slice(0, 40)}…`);

console.log(`\n${LINE}\n  XRPL Wallets\n${LINE}`);
console.log(`  Gateway (robotaxi signer): ${gateway.address}`);
console.log(`  PA issuer (XLS-70 creds):  ${paIssuer.address}`);
console.log(`  Toll booth:               ${toll.address}`);
console.log(`  Charging station:         ${charging.address}`);
console.log(`  Parking / repair:         ${parking.address}`);

console.log(`\n${LINE}\n  PA Admin Key\n${LINE}`);
console.log(`  ${paAdminKey}`);
console.log(`  → Set MPCP_ADMIN_KEY=${paAdminKey} in mpcp-policy-authority/.env\n`);
console.log(LINE);

// ── Confirm ───────────────────────────────────────────────────────────────────

function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim().toLowerCase()); }));
}

const answer = await prompt("\nFund wallets from XRPL testnet faucet and write web/.env? [y/N] ");
if (answer !== "y" && answer !== "yes") {
  console.log("\nAborted — no files written.");
  process.exit(0);
}

// ── Fund ──────────────────────────────────────────────────────────────────────

console.log("\nFunding from testnet faucet…");
await fundWallet(gateway.address,  "gateway");
await fundWallet(paIssuer.address, "PA issuer (XLS-70)");
await fundWallet(toll.address,     "toll booth");
await fundWallet(charging.address, "charging station");
await fundWallet(parking.address,  "parking/repair");

// ── Write web/.env ────────────────────────────────────────────────────────────

function ensureEnv(path: string, example: string): void {
  if (!existsSync(path)) {
    if (existsSync(example)) writeFileSync(path, readFileSync(example, "utf-8"));
    else writeFileSync(path, "");
  }
}

function writeEnv(path: string, values: Record<string, string>): void {
  let content = readFileSync(path, "utf-8");
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    content = re.test(content) ? content.replace(re, line) : content.trimEnd() + `\n${line}\n`;
  }
  writeFileSync(path, content);
}

ensureEnv(WEB_ENV, WEB_EXAMPLE);
writeEnv(WEB_ENV, {
  MPCP_SBA_SIGNING_PRIVATE_KEY_PEM: privPem,
  MPCP_SBA_SIGNING_PUBLIC_KEY_PEM:  pubPem,
  XRPL_GATEWAY_SEED:               gateway.seed!,
  XRPL_GATEWAY_ADDRESS:            gateway.address,
  XRPL_MERCHANT_TOLL_ADDRESS:      toll.address,
  XRPL_MERCHANT_CHARGING_ADDRESS:  charging.address,
  XRPL_MERCHANT_PARKING_ADDRESS:   parking.address,
  POLICY_AUTHORITY_URL:            "http://localhost:3000",
  PA_ADMIN_KEY:                    paAdminKey,
  ROBOTAXI_ID:                     "TX-001",
});

console.log(`\n  ✓ ${WEB_ENV}`);

// ── Write PA .env (XRPL issuer seed + admin key + testnet WSS) ─────────────

ensureEnv(PA_ENV, "");
writeEnv(PA_ENV, {
  MPCP_ADMIN_KEY:          paAdminKey,
  MPCP_XRPL_ISSUER_SEED:  paIssuer.seed!,
  MPCP_XRPL_WSS_URL:      "wss://s.altnet.rippletest.net:51233",
});
console.log(`  ✓ ${PA_ENV}`);

console.log(`
Done. Next steps:
  1. Start Policy Authority:  cd ../mpcp-policy-authority && npm run dev
  2. Start web app:           cd web && npm run dev   # → http://localhost:3001
`);
