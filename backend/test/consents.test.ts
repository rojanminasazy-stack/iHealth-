import { describe, expect, it } from "vitest";
import { CONSENTS, missingConsents } from "../src/domain/consents.js";

describe("Consents before a visit", () => {
  it("asks a new patient for both", () => {
    expect(missingConsents({})).toEqual(["telehealth", "privacyNotice"]);
  });
  it("is satisfied by the current versions", () => {
    const at = "2026-11-23T00:00:00Z";
    expect(
      missingConsents({ consents: { telehealth: { version: CONSENTS.telehealth.version, at }, privacyNotice: { version: CONSENTS.privacyNotice.version, at } } }),
    ).toEqual([]);
  });
  it("asks again when the wording changes", () => {
    const at = "2026-11-23T00:00:00Z";
    expect(missingConsents({ consents: { telehealth: { version: "old", at }, privacyNotice: { version: CONSENTS.privacyNotice.version, at } } })).toEqual(["telehealth"]);
  });
  it("tells patients the service is video only and points to in-person care elsewhere", () => {
    expect(CONSENTS.telehealth.text).toMatch(/video only/);
    expect(CONSENTS.telehealth.text).toMatch(/urgent care or an emergency room/);
  });
});
