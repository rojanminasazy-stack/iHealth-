import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { body, caller, handler, HttpError, json } from "../lib/http.js";
import { ddb, nowIso, tables, todayIso } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import * as v from "../domain/validation.js";
import type { PatientProfile } from "../domain/types.js";
import { CONSENTS, missingConsents, type ConsentKind } from "../domain/consents.js";

export async function getPatientProfile(userId: string): Promise<PatientProfile | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: tables.patients, Key: { userId } }));
  return r.Item as PatientProfile | undefined;
}

/** GET /patient/profile — the patient's own "About you" answers (or null if not filled in yet). */
export const get = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const profile = (await getPatientProfile(c.userId)) ?? null;
  return json(200, { profile, consentsNeeded: missingConsents(profile ?? undefined) });
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
    preferredLanguage: b.preferredLanguage ? v.language(b.preferredLanguage, "Preferred language") : "en",
    consents: existing?.consents,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  await ddb.send(new PutCommand({ TableName: tables.patients, Item: p }));
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "PATIENT_PROFILE_UPDATED", resourceType: "PATIENT", resourceId: c.userId, result: "ALLOWED" });
  return json(200, { profile: p });
});

/** GET /patient/consents: the exact wording the app shows, with its version. */
export const consentText = handler(async (e) => {
  caller(e, "PATIENT");
  return json(200, { consents: CONSENTS });
});

/**
 * POST /patient/consents  { accepted: [{ kind: "telehealth", version: "2026-11-23" }, ...] }
 * Records that the patient agreed to this exact version. A stale version is refused so we
 * never record agreement to wording the patient didn't see.
 */
export const consent = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const accepted = body(e).accepted;
  if (!Array.isArray(accepted) || accepted.length === 0) throw new HttpError(400, "Nothing to agree to.");
  if (!(await getPatientProfile(c.userId))) throw new HttpError(409, "Please finish the About you questions first.");
  const at = nowIso();
  for (const a of accepted.slice(0, 5) as { kind?: unknown; version?: unknown }[]) {
    const kind = a?.kind as ConsentKind;
    if (!(kind in CONSENTS)) throw new HttpError(400, "Unknown consent.");
    if (a.version !== CONSENTS[kind].version) throw new HttpError(409, "This wording was just updated. Please review it again.");
    await ddb.send(
      new UpdateCommand({
        TableName: tables.patients,
        Key: { userId: c.userId },
        UpdateExpression: "SET consents = if_not_exists(consents, :empty), updatedAt = :at",
        ExpressionAttributeValues: { ":empty": {}, ":at": at },
      }),
    );
    await ddb.send(
      new UpdateCommand({
        TableName: tables.patients,
        Key: { userId: c.userId },
        UpdateExpression: "SET consents.#k = :v",
        ExpressionAttributeNames: { "#k": kind },
        ExpressionAttributeValues: { ":v": { version: CONSENTS[kind].version, at } },
      }),
    );
    await audit({ actorId: c.userId, actorRole: "PATIENT", action: "CONSENT_RECORDED", resourceType: "PATIENT", resourceId: `${c.userId}#${kind}#${CONSENTS[kind].version}`, result: "ALLOWED" });
  }
  return json(200, { consentsNeeded: missingConsents(await getPatientProfile(c.userId)) });
});
