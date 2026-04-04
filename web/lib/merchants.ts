/**
 * Merchant configurations — static definitions for each service type.
 * Amounts are in XRP (human-readable) for the x402 challenge,
 * and converted to drops for MPCP session accounting.
 */

export type MerchantType = "toll" | "charging" | "parking";

export interface MerchantConfig {
  type: MerchantType;
  name: string;
  emoji: string;
  description: string;
  purpose: string;          // MPCP allowedPurposes value
  amountXrp: string;        // e.g. "1" → 1 XRP
  amountDrops: string;      // e.g. "1000000"
}

export const MERCHANTS: Record<MerchantType, MerchantConfig> = {
  toll: {
    type: "toll",
    name: "Toll Booth",
    emoji: "🛣️",
    description: "Highway toll charge — Station A7",
    purpose: "transport:toll",
    amountXrp: "1",
    amountDrops: "1000000",
  },
  charging: {
    type: "charging",
    name: "EV Charging",
    emoji: "⚡",
    description: "Fast charging — 50 kWh session",
    purpose: "transport:charging",
    amountXrp: "5",
    amountDrops: "5000000",
  },
  parking: {
    type: "parking",
    name: "Parking / Repair",
    emoji: "🔧",
    description: "Secure parking bay / service stop",
    purpose: "transport:parking",
    amountXrp: "2",
    amountDrops: "2000000",
  },
};

export function getMerchantAddress(type: MerchantType): string {
  const envKey = `XRPL_MERCHANT_${type.toUpperCase()}_ADDRESS`;
  const addr = process.env[envKey];
  if (!addr) throw new Error(`${envKey} is not set`);
  return addr;
}

/** Grant presets shown in the Fleet Manager panel. */
export interface GrantPreset {
  id: string;
  label: string;
  description: string;
  purposes: string[];
  /** Total authorized budget in XRP drops — included in the PA-signed PolicyGrant. */
  budgetDrops: string;
  budgetXrp: string;     // human label
  /** PA-signed per-transaction limit for offline merchant acceptance (drops). */
  offlineMaxSinglePaymentDrops: string;
}

export const GRANT_PRESETS: GrantPreset[] = [
  {
    id: "full",
    label: "Full Access",
    description: "All services, 20 XRP budget",
    purposes: ["transport:toll", "transport:charging", "transport:parking"],
    budgetDrops: "20000000",
    budgetXrp: "20",
    offlineMaxSinglePaymentDrops: "5000000",
  },
  {
    id: "no-toll",
    label: "No Toll Roads",
    description: "Charging + parking only, 20 XRP budget",
    purposes: ["transport:charging", "transport:parking"],
    budgetDrops: "20000000",
    budgetXrp: "20",
    offlineMaxSinglePaymentDrops: "5000000",
  },
  {
    id: "tight",
    label: "Tight Budget",
    description: "All services, 3 XRP — runs out fast",
    purposes: ["transport:toll", "transport:charging", "transport:parking"],
    budgetDrops: "3000000",
    budgetXrp: "3",
    offlineMaxSinglePaymentDrops: "3000000",
  },
];
