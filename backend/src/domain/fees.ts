/**
 * Patient pricing (no booking fee):
 *  - Pay per visit: flat $79 for a 20-minute video visit, paid to the physician's own Stripe account.
 *  - Unlimited membership: $99/month. How physicians are paid for member visits is pending legal review
 *    (see docs/fee-model.md) and is not wired up yet.
 * Physicians pay a flat monthly platform subscription, billed separately.
 */
export const FEES = {
  bookingFeeCents: 0,
  visitPriceCents: 7_900,
  membershipMonthlyCents: 9_900,
  visitMinutes: 20,
  subscriptionStandardCents: 19_900,
  subscriptionFoundingCents: 9_900,
  foundingTrialDays: 90,
  foundingSeats: 50,
  minVisitPriceCents: 2_500,
  maxVisitPriceCents: 30_000,
} as const;

export interface Quote {
  visitPriceCents: number;
  bookingFeeCents: number;
  totalCents: number;
  /** Amount iHealthé keeps (Stripe application_fee_amount). */
  platformFeeCents: number;
  /** Amount transferred to the physician. */
  physicianReceivesCents: number;
}

export class FeeError extends Error {}

export function validateVisitPrice(cents: number): void {
  if (!Number.isInteger(cents)) throw new FeeError("Visit price must be whole cents.");
  if (cents < FEES.minVisitPriceCents || cents > FEES.maxVisitPriceCents) {
    throw new FeeError(
      `Visit price must be between $${FEES.minVisitPriceCents / 100} and $${FEES.maxVisitPriceCents / 100}.`,
    );
  }
}

/** Server-side quote. The app never sends a price; it is always computed here. */
export function quote(visitPriceCents: number = FEES.visitPriceCents): Quote {
  validateVisitPrice(visitPriceCents);
  const bookingFeeCents = FEES.bookingFeeCents;
  return {
    visitPriceCents,
    bookingFeeCents,
    totalCents: visitPriceCents + bookingFeeCents,
    platformFeeCents: bookingFeeCents,
    physicianReceivesCents: visitPriceCents,
  };
}

export interface SubscriptionPlan {
  priceCents: number;
  trialDays: number;
  label: string;
}

/** Founding seats go to the first N physicians approved. */
export function subscriptionPlanFor(foundingSeatsUsed: number): SubscriptionPlan {
  if (foundingSeatsUsed < FEES.foundingSeats) {
    return {
      priceCents: FEES.subscriptionFoundingCents,
      trialDays: FEES.foundingTrialDays,
      label: "Founding Physician",
    };
  }
  return { priceCents: FEES.subscriptionStandardCents, trialDays: 0, label: "Standard" };
}

export const FOUNDING_PLAN: SubscriptionPlan = {
  priceCents: FEES.subscriptionFoundingCents,
  trialDays: FEES.foundingTrialDays,
  label: "Founding Physician",
};
export const STANDARD_PLAN: SubscriptionPlan = { priceCents: FEES.subscriptionStandardCents, trialDays: 0, label: "Standard" };
