import { describe, expect, it } from "vitest";
import { FEES, quote, subscriptionPlanFor, FeeError } from "../src/domain/fees.js";

describe("hybrid fees", () => {
  it("patient pays visit price + booking fee; physician gets the full visit price", () => {
    expect(quote(7_900)).toEqual({
      visitPriceCents: 7_900,
      bookingFeeCents: 900,
      totalCents: 8_800,
      platformFeeCents: 900,
      physicianReceivesCents: 7_900,
    });
  });

  it("platform fee is flat, never a percentage of the visit", () => {
    expect(quote(2_500).platformFeeCents).toBe(quote(30_000).platformFeeCents);
  });

  it("rejects prices outside limits or fractional cents", () => {
    expect(() => quote(2_499)).toThrow(FeeError);
    expect(() => quote(30_001)).toThrow(FeeError);
    expect(() => quote(79.5)).toThrow(FeeError);
  });

  it("first 50 physicians get the founding plan, then standard", () => {
    expect(subscriptionPlanFor(0)).toMatchObject({ priceCents: 9_900, trialDays: 90 });
    expect(subscriptionPlanFor(FEES.foundingSeats - 1).label).toBe("Founding Physician");
    expect(subscriptionPlanFor(FEES.foundingSeats)).toMatchObject({ priceCents: 19_900, trialDays: 0 });
  });
});
