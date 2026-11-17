import { describe, expect, it } from "vitest";
import { activationBlockers, assertProviderTransition, assertRequestTransition, TransitionError } from "../src/domain/stateMachines.js";
import { npi, ValidationError } from "../src/domain/validation.js";
import { TEMPLATES } from "../src/lib/notify.js";
import { provider } from "./fixtures.js";

describe("state machines", () => {
  it("physicians can't skip review", () => {
    expect(() => assertProviderTransition("APPLIED", "APPROVED")).toThrow(TransitionError);
    expect(() => assertProviderTransition("APPLIED", "ACTIVE")).toThrow(TransitionError);
    expect(() => assertProviderTransition("UNDER_REVIEW", "APPROVED")).not.toThrow();
  });

  it("rejected physicians stay rejected", () => {
    expect(() => assertProviderTransition("REJECTED", "UNDER_REVIEW")).toThrow(TransitionError);
  });

  it("completed or cancelled visits can't be reopened", () => {
    expect(() => assertRequestTransition("COMPLETED", "MATCHED")).toThrow(TransitionError);
    expect(() => assertRequestTransition("CANCELLED", "OFFERED")).toThrow(TransitionError);
  });

  it("lists what blocks activation", () => {
    const p = provider({ status: "APPROVED", baaSignedAt: undefined, stripeChargesEnabled: false, subscriptionStatus: undefined });
    expect(activationBlockers(p)).toEqual(["Business Associate Agreement not signed", "Payout account not set up", "Subscription not started"]);
    expect(activationBlockers(provider({ status: "APPROVED" }))).toEqual([]);
  });
});

describe("NPI validation", () => {
  it("accepts a valid NPI and rejects a bad check digit", () => {
    expect(npi("1234567893")).toBe("1234567893");
    expect(() => npi("1234567890")).toThrow(ValidationError);
    expect(() => npi("12345")).toThrow(ValidationError);
  });
});

describe("notifications contain no health information", () => {
  const banned = /symptom|diagnos|prescri|condition|fever|pain|psychiat|dermat|lab result|Dr\./i;
  for (const [name, t] of Object.entries(TEMPLATES)) {
    it(name, () => {
      expect(t.subject).not.toMatch(banned);
      expect(t.text).not.toMatch(banned);
      expect(t.text).not.toMatch(/\$\{/);
    });
  }
});

import { ageOn, dateOfBirth, phone, zip } from "../src/domain/validation.js";
describe("patient profile validation", () => {
  it("computes age and requires 18+", () => {
    expect(ageOn("2000-11-17", "2026-11-16")).toBe(25);
    expect(ageOn("2000-11-16", "2026-11-16")).toBe(26);
    expect(() => dateOfBirth("2010-01-01", "2026-11-16")).toThrow(ValidationError);
    expect(() => dateOfBirth("2030-01-01", "2026-11-16")).toThrow(ValidationError);
    expect(dateOfBirth("1990-05-04", "2026-11-16")).toBe("1990-05-04");
  });
  it("normalizes US phone numbers and checks ZIP codes", () => {
    expect(phone("(661) 555-0123")).toBe("+16615550123");
    expect(phone("+16615550123")).toBe("+16615550123");
    expect(() => phone("12345")).toThrow(ValidationError);
    expect(zip("91355")).toBe("91355");
    expect(() => zip("9135")).toThrow(ValidationError);
  });
});
