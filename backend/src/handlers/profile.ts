import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { body, caller, handler, json } from "../lib/http.js";
import { ddb, nowIso, tables, todayIso } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import * as v from "../domain/validation.js";
import type { PatientProfile } from "../domain/types.js";

export async function getPatientProfile(userId: string): Promise<PatientProfile | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: tables.patients, Key: { userId } }));
  return r.Item as PatientProfile | undefined;
}

/** GET /patient/profile — the patient's own "About you" answers (or null if not filled in yet). */
export const get = handler(async (e) => {
  const c = caller(e, "PATIENT");
  return json(200, { profile: (await getPatientProfile(c.userId)) ?? null });
});

/** PUT /patient/profile — create or update "About you". Identity comes from the sign-in token, never the body. */
export const put = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const b = body(e);
  const a = (b.address ?? {}) as Record<string, unknown>;
  const existing = await getPatientProfile(c.userId);
  const at = nowIso();
  const p: PatientProfile = {
    userId: c.userId,
    fullName: v.str(b.fullName, "Full name", 120),
    dateOfBirth: v.dateOfBirth(b.dateOfBirth, todayIso()),
    phone: v.phone(b.phone),
    address: {
      line1: v.str(a.line1, "Street address", 120),
      line2: v.text(a.line2, "Apartment or unit", 60) || undefined,
      city: v.str(a.city, "City", 80),
      state: v.state(a.state, "Address state"),
      zip: v.zip(a.zip),
    },
    stateOfResidence: v.state(b.stateOfResidence, "State of residence"),
    medicalHistory: v.text(b.medicalHistory, "Health history"),
    medications: v.text(b.medications, "Current medications"),
    chronicConditions: v.text(b.chronicConditions, "Chronic conditions"),
    allergies: v.text(b.allergies, "Allergies", 1000),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  await ddb.send(new PutCommand({ TableName: tables.patients, Item: p }));
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "PATIENT_PROFILE_UPDATED", resourceType: "PATIENT", resourceId: c.userId, result: "ALLOWED" });
  return json(200, { profile: p });
});
