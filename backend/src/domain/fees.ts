/**
 * Hybrid fee model.
 *  - Patient pays: physician's visit price + flat booking fee.
 *  - Visit price goes to the physician's own Stripe account. iHealthé keeps only the booking fee.
 *  - Physicians pay a flat monthly subscription, billed separately.
 * No percentage of the medical fee is ever taken (see docs/fee-model.md).
 */
export const FEES = {
  bookingFeeCents: 900,
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
export function quote(visitPriceCents: number): Quote {
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
