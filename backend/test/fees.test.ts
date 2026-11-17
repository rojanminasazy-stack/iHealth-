import { describe, expect, it } from "vitest";
import { FEES, quote, subscriptionPlanFor, FeeError } from "../src/domain/fees.js";

describe("patient pricing", () => {
  it("default visit is a flat $79 with no booking fee", () => {
    expect(quote()).toEqual({ visitPriceCents: 7_900, bookingFeeCents: 0, totalCents: 7_900, platformFeeCents: 0, physicianReceivesCents: 7_900 });
    expect(FEES.membershipMonthlyCents).toBe(9_900);
    expect(FEES.visitMinutes).toBe(20);
  });
});

describe("custom visit prices", () => {

  it("platform never takes a percentage of the visit", () => {
    expect(quote(2_500).platformFeeCents).toBe(0);
    expect(quote(30_000).physicianReceivesCents).toBe(30_000);
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
