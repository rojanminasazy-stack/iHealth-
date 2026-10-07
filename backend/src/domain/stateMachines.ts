import type { CareRequestStatus, Provider, ProviderStatus } from "./types.js";
import { subscriptionOk } from "./eligibility.js";

const PROVIDER_TRANSITIONS: Record<ProviderStatus, ProviderStatus[]> = {
  APPLIED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["ACTIVE", "SUSPENDED"],
  ACTIVE: ["SUSPENDED"],
  SUSPENDED: ["ACTIVE"],
  REJECTED: [],
};

const REQUEST_TRANSITIONS: Record<CareRequestStatus, CareRequestStatus[]> = {
  REQUESTED: ["OFFERED", "MATCHED", "CANCELLED", "EXPIRED"],
  OFFERED: ["MATCHED", "CANCELLED", "EXPIRED"],
  MATCHED: ["IN_VISIT", "CANCELLED", "PROVIDER_CANCELLED"],
  IN_VISIT: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  PROVIDER_CANCELLED: [],
};

export class TransitionError extends Error {}

export function assertProviderTransition(from: ProviderStatus, to: ProviderStatus): void {
  if (!PROVIDER_TRANSITIONS[from].includes(to)) {
    throw new TransitionError(`Physician status can't go from ${from} to ${to}.`);
  }
}

export function assertRequestTransition(from: CareRequestStatus, to: CareRequestStatus): void {
  if (!REQUEST_TRANSITIONS[from].includes(to)) {
    throw new TransitionError(`Request status can't go from ${from} to ${to}.`);
  }
}

/** What still blocks an APPROVED physician from going ACTIVE. Shown in the physician app. */
export function activationBlockers(p: Provider): string[] {
  const out: string[] = [];
  if (p.status !== "APPROVED" && p.status !== "SUSPENDED") out.push("Application not yet approved");
  if (!p.licenses.some((l) => l.verifiedAt)) out.push("No verified license");
  if (!p.baaSignedAt) out.push("Business Associate Agreement not signed");
  if (!p.stripeAccountId || !p.stripeChargesEnabled) out.push("Payout account not set up");
  if (!subscriptionOk(p.subscriptionStatus)) out.push("Subscription not started");
  return out;
}
