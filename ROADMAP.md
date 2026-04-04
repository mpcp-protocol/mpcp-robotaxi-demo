# mpcp-robotaxi — Roadmap

## Completed

- **P1** — Core demo: grant issuance, MPCP session, XRPL on-chain settlement
- **P2** — Offline merchant mode: Trust Bundle download, SBA + PolicyGrant verification without network
- **P3** — Grant revocation: revoke via PA, UI shows revoked state, merchant rejects via MPCP session
- **P4** — Dev View: expandable JSON artifacts (grant, policy, SBA, challenge) in event feed
- **P5** — Deferred settlement: offline-accepted payments queue and settle on XRPL when merchant reconnects

## Planned

### P6 — Offline-Accept-Then-Revoke Scenario + Dispute Resolution

**Scenario:** A robotaxi charges at an offline EV station. The station verifies the SBA + PolicyGrant via Trust Bundle and grants access. Later, the fleet operator revokes the grant. When the EV station comes back online, the deferred XRPL settlement fails because the grant is no longer active.

This is an inherent trade-off of offline-first payment protocols — the spec acknowledges it explicitly:

> *"Offline verifiers cannot call a revocation endpoint. A grant revoked by the policy authority will remain valid on an offline device until the device reconnects and refreshes its bundles."*
> — [mpcp-spec / Trust Bundles](../mpcp-spec/docs/protocol/trust-bundles.md)

**Demo goals:**

1. Walk through the full scenario in the UI:
   - Issue grant → take merchant offline → charge → revoke grant → bring merchant online → deferred settlement fails
2. Show the failed settlement clearly in the event feed with the reason (`grant_revoked`)
3. Demonstrate the dispute resolution evidence bundle:
   - The signed SBA (proof the agent authorized the payment)
   - The signed PolicyGrant (proof the PA authorized the scope)
   - The Trust Bundle (proof the merchant verified in good faith)
   - The revocation timestamp (proof the revocation happened after offline acceptance)

**Who bears the cost?**

The dispute is not about whether the revocation was correct — it may have been entirely justified (e.g., the robotaxi was compromised). The dispute is about **who pays the merchant** for a service already rendered under a cryptographically valid authorization. The merchant verified the SBA and PolicyGrant in good faith; the policy signer (fleet operator / PA) revoked the grant for a legitimate reason. Both parties acted correctly, yet there is an unsettled debt.

The dispute resolution must be directed at the **policy signer that issued and then revoked the grant** — they are the party that authorized the scope of spending, accepted the risk of offline acceptance (via `offlineMaxSinglePayment`), and made the revocation decision. The merchant's evidence bundle proves the authorization was valid at time of service.

**Protocol-level considerations for the spec:**

- **Escrow as backstop:** The budget escrow on XRPL guarantees the funds existed at grant time. Even after revocation, the escrow may still be releasable if the preimage is available — settlement could succeed against the escrow rather than the gateway's live balance. This is the cleanest resolution: the escrowed funds cover the merchant regardless of grant status.
- **`offlineMaxSinglePayment` as risk acceptance:** By setting this field, the policy signer explicitly accepted liability for offline payments up to that amount per transaction. This bounds the merchant's exposure and establishes the policy signer's obligation.
- **Grace period:** A `revocationGracePeriod` field on PolicyGrant could allow deferred settlements to succeed within N minutes of revocation, acknowledging offline latency.
- **Dispute resolution flow:** The [spec's dispute resolution guide](../mpcp-spec/docs/guides/dispute-resolution.md) should be extended to cover offline-accept-then-revoke as a named scenario. The recommended resolution: policy signer compensates the merchant, using the evidence bundle as proof of valid service.
- **ArtifactBundle for offline disputes:** Package the SBA, PolicyGrant, Trust Bundle snapshot, merchant's offline verification timestamp, and the revocation event into an [ArtifactBundle](../mpcp-spec/docs/protocol/ArtifactBundle.md) that can be submitted to the policy signer or an arbitrator.

### P7 — Gateway-Level Purpose Enforcement

**Problem:** `allowedPurposes` is currently only enforced by the agent. The spec states it is *"enforced by the agent, not by the MPCP verifier"*. A compromised agent can skip its own purpose check, call `createSba()` for any merchant, and the gateway signer will sign and submit the XRPL payment without verifying purpose.

**Solution:** The gateway signer is the trust boundary — it holds the XRPL private key and the agent cannot bypass it. The signer already enforces budget ceiling, SBA validity, and gateway authorization from the PA-signed grant. Purpose is the missing check.

**Implementation:**

1. Store `allowedPurposes` (from the PA-signed grant) in signer state alongside `budgetMinor` and `authorizedGateway`
2. Require `purpose` in signer requests (alongside `sba` and `challenge`)
3. Reject with `purpose_denied` if the purpose is not in the PA-signed `allowedPurposes`

**Trust model after this change:**

| Enforcement point | What it checks | Trusted? |
|---|---|---|
| Agent (action route) | Purpose, budget, revocation | No — can be bypassed if compromised |
| MPCP session (`createSba`) | Budget ceiling, expiry, revocation | Yes — but no purpose field in SBA |
| Gateway signer | SBA validity, budget, gateway auth, **purpose** | Yes — holds keys, agent cannot bypass |
| Merchant | SBA + PolicyGrant signatures (offline), on-chain settlement (online) | Yes — independent party |

A compromised agent that skips purpose checking wastes its own budget ceiling (the SBA is signed) but no XRPL payment is made — the signer refuses to sign the transaction.

### P8 — Merchant Balance Reconciliation

Show real-time merchant wallet balances updating after deferred settlements complete. Highlight discrepancies between expected (offline-accepted) and actual (on-chain) balances.

### P9 — Multi-Vehicle Fleet

Multiple robotaxis operating under the same PolicyGrant with independent sessions and budget tracking. Demonstrates the session-scoped budget ceiling vs. grant-level budget.
