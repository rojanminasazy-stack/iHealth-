import type { CareRequest, Provider } from "./types.js";
import { isEligible } from "./eligibility.js";

/**
 * Uber-style dispatch rules, kept pure so they can be tested.
 *  - A physician is "available now" when online, their app checked in recently, and they're not in a visit.
 *  - A request is offered to every available, eligible physician in the patient's state
 *    (or only to the one the patient picked). The first to accept wins; acceptance is atomic in the database.
 *  - A request nobody accepts within the offer window expires and the patient's card hold is released.
 */
export const DISPATCH = {
  /** The physician app checks in every 5 seconds while online. */
  heartbeatStaleAfterMs: 90_000,
  /** How long patients wait for a physician before we stop searching. */
  offerWindowMs: 10 * 60_000,
} as const;

export function isAvailableNow(p: Provider, nowMs: number): boolean {
  if (!p.online || p.busyWith) return false;
  if (!p.lastSeenAt) return false;
  return nowMs - Date.parse(p.lastSeenAt) <= DISPATCH.heartbeatStaleAfterMs;
}

export function offerExpired(r: Pick<CareRequest, "createdAt">, nowMs: number): boolean {
  return nowMs - Date.parse(r.createdAt) > DISPATCH.offerWindowMs;
}

/** May this request be offered to (and accepted by) this physician right now? */
export function canOffer(p: Provider, r: CareRequest, today: string, nowMs: number): boolean {
  if (r.status !== "OFFERED") return false;
  if (offerExpired(r, nowMs)) return false;
  if (r.requestedProviderId && r.requestedProviderId !== p.providerId) return false;
  if (r.declinedBy?.includes(p.providerId)) return false;
  if (!speaks(p, r.language)) return false;
  if (!isAvailableNow(p, nowMs)) return false;
  return isEligible(p, { patientState: r.patientState, ageGroup: r.ageGroup, specialty: r.specialty, today });
}

/** True when no language was asked for, or the physician speaks the one the patient asked for. */
export function speaks(p: Pick<Provider, "languages">, language: string | undefined): boolean {
  return !language || p.languages.includes(language);
}

export function secondsLeft(r: Pick<CareRequest, "createdAt">, nowMs: number): number {
  return Math.max(0, Math.round((Date.parse(r.createdAt) + DISPATCH.offerWindowMs - nowMs) / 1000));
}
