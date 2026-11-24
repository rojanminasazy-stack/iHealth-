import { describe, expect, it } from "vitest";
import { canOffer, isAvailableNow, offerExpired, secondsLeft, DISPATCH } from "../src/domain/dispatch.js";
import type { CareRequest } from "../src/domain/types.js";
import { provider } from "./fixtures.js";

const NOW = Date.parse("2026-11-18T20:00:00Z");
const fresh = new Date(NOW - 10_000).toISOString();
const doc = (over = {}) => provider({ lastSeenAt: fresh, ...over });
const req = (over: Partial<CareRequest> = {}): CareRequest => ({
  requestId: "req_1",
  patientUserId: "pat_1",
  patientState: "CA",
  ageGroup: "ADULT",
  specialty: "FAMILY_MEDICINE",
  chiefComplaint: "Sore throat",
  symptomDuration: "Yesterday",
  status: "OFFERED",
  patientContact: {},
  createdAt: new Date(NOW - 60_000).toISOString(),
  updatedAt: new Date(NOW - 60_000).toISOString(),
  expiresAt: 0,
  ...over,
});
const TODAY = "2026-11-18";

describe("Uber-style dispatch", () => {
  it("offers a first-available request to any available physician licensed in the patient's state", () => {
    expect(canOffer(doc(), req(), TODAY, NOW)).toBe(true);
  });

  it("never offers across state lines", () => {
    expect(canOffer(doc(), req({ patientState: "NY" }), TODAY, NOW)).toBe(false);
  });

  it("treats a physician whose app stopped checking in as offline", () => {
    const stale = doc({ lastSeenAt: new Date(NOW - DISPATCH.heartbeatStaleAfterMs - 1).toISOString() });
    expect(isAvailableNow(stale, NOW)).toBe(false);
    expect(canOffer(stale, req(), TODAY, NOW)).toBe(false);
  });

  it("doesn't offer new patients to a physician already in a visit", () => {
    expect(canOffer(doc({ busyWith: "req_other" }), req(), TODAY, NOW)).toBe(false);
  });

  it("respects a patient's chosen physician", () => {
    expect(canOffer(doc({ providerId: "a" }), req({ requestedProviderId: "b" }), TODAY, NOW)).toBe(false);
    expect(canOffer(doc({ providerId: "b" }), req({ requestedProviderId: "b" }), TODAY, NOW)).toBe(true);
  });

  it("doesn't re-offer to a physician who declined", () => {
    expect(canOffer(doc({ providerId: "a" }), req({ declinedBy: ["a"] }), TODAY, NOW)).toBe(false);
  });

  it("expires requests nobody accepts in time", () => {
    const old = req({ createdAt: new Date(NOW - DISPATCH.offerWindowMs - 1).toISOString() });
    expect(offerExpired(old, NOW)).toBe(true);
    expect(canOffer(doc(), old, TODAY, NOW)).toBe(false);
    expect(secondsLeft(req(), NOW)).toBe(840); // created 1 minute ago, 15-minute window
  });

  it("only offers paid-for open requests", () => {
    expect(canOffer(doc(), req({ status: "REQUESTED" }), TODAY, NOW)).toBe(false);
    expect(canOffer(doc(), req({ status: "MATCHED" }), TODAY, NOW)).toBe(false);
  });
});

describe("Language match", () => {
  it("offers a language-matched request only to physicians who speak that language", () => {
    expect(canOffer(doc({ languages: ["en", "fa"] }), req({ language: "fa" }), TODAY, NOW)).toBe(true);
    expect(canOffer(doc({ languages: ["en", "es"] }), req({ language: "fa" }), TODAY, NOW)).toBe(false);
  });

  it("offers to everyone when the patient didn't ask for a language", () => {
    expect(canOffer(doc({ languages: ["es"] }), req(), TODAY, NOW)).toBe(true);
  });

  it("still never crosses state lines for a language match", () => {
    expect(canOffer(doc({ languages: ["hy"] }), req({ language: "hy", patientState: "NY" }), TODAY, NOW)).toBe(false);
  });
});
