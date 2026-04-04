/**
 * Signer-side independent spend counter (dual enforcement).
 * Separate from the MPCP session counter — both must agree before payment.
 *
 * The spend ceiling is sourced exclusively from the PA-signed grant's budgetMinor —
 * never from UI input or agent-controlled data.
 */

interface GrantRecord {
  grantId: string | null;
  /** PA-signed budget in XRP drops — the immutable ceiling for this signer. */
  ceilingDrops: string;
  /** XRPL address of the only gateway authorized to spend against this grant. PA-signed. */
  authorizedGateway: string | null;
}

class SignerState {
  private grant: GrantRecord | null = null;
  private spentDrops: bigint = 0n;

  setGrant(g: GrantRecord): void {
    this.grant      = g;
    this.spentDrops = 0n;
  }

  clearGrant(): void {
    this.grant      = null;
    this.spentDrops = 0n;
  }

  hasGrant(): boolean {
    return this.grant !== null;
  }

  trySpend(amountDrops: bigint): boolean {
    if (!this.grant) return false;
    const ceiling = BigInt(this.grant.ceilingDrops);
    if (this.spentDrops + amountDrops > ceiling) return false;
    this.spentDrops += amountDrops;
    return true;
  }

  getRemaining(): string {
    if (!this.grant) return "0";
    const ceiling = BigInt(this.grant.ceilingDrops);
    const rem = ceiling - this.spentDrops;
    return rem < 0n ? "0" : String(rem);
  }

  getSpent(): string {
    return String(this.spentDrops);
  }

  getGrantId(): string | null {
    return this.grant?.grantId ?? null;
  }

  getAuthorizedGateway(): string | null {
    return this.grant?.authorizedGateway ?? null;
  }
}

const g = globalThis as typeof globalThis & { __signerState?: SignerState };
if (!g.__signerState) g.__signerState = new SignerState();
export const signerState = g.__signerState;
