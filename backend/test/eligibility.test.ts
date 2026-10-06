import { describe, expect, it } from "vitest";
import { checkEligibility, findEligible } from "../src/domain/eligibility.js";
import { provider, CA_ADULT } from "./fixtures.js";

describe("eligibility", () => {
  it("allows a fully set-up, online physician licensed in the patient's state", () => {
    expect(checkEligibility(provider(), CA_ADULT)).toEqual([]);
  });

  it("blocks a physician with no license where the patient is located", () => {
    expect(checkEligibility(provider(), { ...CA_ADULT, patientState: "NY" })).toContain("NO_LICENSE_IN_STATE");
  });

  it("blocks an unverified license", () => {
    const p = provider({ licenses: [{ state: "CA", number: "A-1", expiresOn: "2028-01-01" }] });
    expect(checkEligibility(p, CA_ADULT)).toContain("LICENSE_NOT_VERIFIED");
  });

  it("blocks an expired license", () => {
    const p = provider({ licenses: [{ state: "CA", number: "A-1", expiresOn: "2026-10-04", verifiedAt: "x" }] });
    expect(checkEligibility(p, CA_ADULT)).toContain("LICENSE_EXPIRED");
  });

  it("allows a license expiring today", () => {
    const p = provider({ licenses: [{ state: "CA", number: "A-1", expiresOn: "2026-10-05", verifiedAt: "x" }] });
    expect(checkEligibility(p, CA_ADULT)).toEqual([]);
  });

  it("blocks without BAA, payouts, active status, or online", () => {
    const r = checkEligibility(provider({ baaSignedAt: undefined, stripeChargesEnabled: false, status: "APPROVED", online: false }), CA_ADULT);
    expect(r).toEqual(expect.arrayContaining(["NO_BAA", "PAYMENTS_NOT_READY", "NOT_ACTIVE", "OFFLINE"]));
  });

  it("blocks child patients for physicians who don't see children", () => {
    expect(checkEligibility(provider(), { ...CA_ADULT, ageGroup: "CHILD" })).toContain("NO_PEDIATRICS");
    expect(checkEligibility(provider({ acceptsPediatric: true }), { ...CA_ADULT, ageGroup: "CHILD" })).toEqual([]);
  });

  it("ranks prior physician and language match first, never includes ineligible ones", () => {
    const a = provider({ providerId: "a", rating: 5 });
    const b = provider({ providerId: "b", languages: ["en", "fa"], rating: 4.2 });
    const c = provider({ providerId: "c", rating: 5, avgResponseSeconds: 30 });
    const bad = provider({ providerId: "bad", licenses: [{ state: "TX", number: "T", expiresOn: "2030-01-01", verifiedAt: "x" }] });
    const out = findEligible([a, b, c, bad], CA_ADULT, { preferredLanguage: "fa", previousProviderIds: ["a"] });
    expect(out.map((p) => p.providerId)).toEqual(["a", "b", "c"]);
  });

  it("does not rank by price", () => {
    const cheap = provider({ providerId: "cheap", visitPriceCents: 2_500 });
    const pricey = provider({ providerId: "pricey", visitPriceCents: 30_000 });
    const out = findEligible([pricey, cheap], CA_ADULT);
    expect(out.map((p) => p.providerId)).toEqual(["cheap", "pricey"]); // tie broken by id only
  });
});
