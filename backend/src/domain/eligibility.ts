import type { AgeGroup, Provider, Specialty, StateCode } from "./types.js";

export interface EligibilityQuery {
  patientState: StateCode;
  ageGroup: AgeGroup;
  specialty: Specialty;
  /** ISO date YYYY-MM-DD used for license expiry checks. */
  today: string;
}

export type IneligibleReason =
  | "NOT_ACTIVE"
  | "OFFLINE"
  | "NO_BAA"
  | "PAYMENTS_NOT_READY"
  | "NO_LICENSE_IN_STATE"
  | "LICENSE_NOT_VERIFIED"
  | "LICENSE_EXPIRED"
  | "WRONG_SPECIALTY"
  | "NO_PEDIATRICS";

/**
 * Hard rules. Any failure means the physician may not see or accept this patient.
 * Ranking happens only after this, and can never override it.
 */
export function checkEligibility(p: Provider, q: EligibilityQuery): IneligibleReason[] {
  const reasons: IneligibleReason[] = [];
  if (p.status !== "ACTIVE") reasons.push("NOT_ACTIVE");
  if (!p.online) reasons.push("OFFLINE");
  if (!p.baaSignedAt) reasons.push("NO_BAA");
  if (!p.stripeAccountId || !p.stripeChargesEnabled) reasons.push("PAYMENTS_NOT_READY");

  const lic = p.licenses.find((l) => l.state === q.patientState);
  if (!lic) reasons.push("NO_LICENSE_IN_STATE");
  else {
    if (!lic.verifiedAt) reasons.push("LICENSE_NOT_VERIFIED");
    if (lic.expiresOn < q.today) reasons.push("LICENSE_EXPIRED");
  }

  if (p.specialty !== q.specialty) reasons.push("WRONG_SPECIALTY");
  if (q.ageGroup === "CHILD" && !p.acceptsPediatric) reasons.push("NO_PEDIATRICS");
  return reasons;
}

export function isEligible(p: Provider, q: EligibilityQuery): boolean {
  return checkEligibility(p, q).length === 0;
}

export interface RankOptions {
  preferredLanguage?: string;
  /** Physicians the patient has seen before. */
  previousProviderIds?: string[];
}

/**
 * Rank eligible physicians. Uses care-relevant signals only (continuity, language,
 * responsiveness, rating). Price is shown to the patient but does not boost ranking,
 * so the platform never steers patients toward whoever earns it more.
 */
export function rankEligible(eligible: Provider[], opts: RankOptions = {}): Provider[] {
  const score = (p: Provider): number => {
    let s = 0;
    if (opts.previousProviderIds?.includes(p.providerId)) s += 40;
    if (opts.preferredLanguage && p.languages.includes(opts.preferredLanguage)) s += 25;
    const resp = p.avgResponseSeconds ?? 300;
    s += Math.max(0, 20 - resp / 30); // faster responders score up to 20
    s += ((p.rating ?? 4.5) - 4) * 15; // 4.0–5.0 maps to 0–15
    return s;
  };
  return [...eligible].sort((a, b) => score(b) - score(a) || a.providerId.localeCompare(b.providerId));
}

export function findEligible(all: Provider[], q: EligibilityQuery, opts?: RankOptions): Provider[] {
  return rankEligible(
    all.filter((p) => isEligible(p, q)),
    opts,
  );
}
