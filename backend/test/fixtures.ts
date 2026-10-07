import type { Provider } from "../src/domain/types.js";

/** Fake physician. All data here is synthetic. */
export function provider(over: Partial<Provider> = {}): Provider {
  return {
    providerId: "prv_test1",
    userId: "user_test1",
    fullName: "Jane Testdoctor",
    credentials: "MD",
    npi: "1234567893",
    specialty: "FAMILY_MEDICINE",
    languages: ["en"],
    licenses: [{ state: "CA", number: "A-100000", expiresOn: "2028-01-31", verifiedAt: "2026-10-01T00:00:00Z", verifiedBy: "staff1" }],
    status: "ACTIVE",
    visitPriceCents: 7_900,
    online: true,
    acceptsPediatric: false,
    baaSignedAt: "2026-10-01T00:00:00Z",
    stripeAccountId: "acct_test",
    stripeChargesEnabled: true,
    founding: true,
    subscriptionStatus: "trialing",
    contact: { email: "jane@example.com" },
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

export const CA_ADULT = { patientState: "CA" as const, ageGroup: "ADULT" as const, specialty: "FAMILY_MEDICINE" as const, today: "2026-10-05" };
