import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { body, caller, handler, HttpError, json, type Event } from "../lib/http.js";
import { ddb, newId, nowIso, tables, todayIso } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { getProvider, providersByStatus, publicProfile } from "../lib/providers.js";
import { authorizeVisit, releaseVisit } from "../lib/payments.js";
import { findEligible, isEligible } from "../domain/eligibility.js";
import { assertRequestTransition } from "../domain/stateMachines.js";
import { quote } from "../domain/fees.js";
import * as v from "../domain/validation.js";
import type { CareRequest } from "../domain/types.js";

const REQUEST_TTL_SECONDS = 30 * 60;

function claim(e: Event, name: string): string | undefined {
  const c = e.requestContext.authorizer?.jwt?.claims?.[name];
  return typeof c === "string" ? c : undefined;
}

/**
 * GET /patient/physicians?state=CA&specialty=FAMILY_MEDICINE&ageGroup=ADULT&language=fa
 * Lists physicians who may legally see this patient right now, best match first.
 */
export const listPhysicians = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const q = e.queryStringParameters ?? {};
  const query = {
    patientState: v.state(q.state, "Your current location"),
    specialty: v.specialty(q.specialty ?? "FAMILY_MEDICINE"),
    ageGroup: v.ageGroup(q.ageGroup ?? "ADULT"),
    today: todayIso(),
  };
  const ranked = findEligible(await providersByStatus("ACTIVE"), query, { preferredLanguage: q.language });
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "PROVIDER_LIST_VIEWED", resourceType: "PROVIDER", resourceId: `list:${query.patientState}`, result: "ALLOWED" });
  return json(200, {
    physicians: ranked.slice(0, 50).map((p) => ({ ...publicProfile(p), quote: quote(p.visitPriceCents) })),
  });
});

/**
 * POST /patient/requests — patient picks a physician and describes what's going on.
 * Price is computed here from the physician's record; the app never sends a price.
 * Returns a Stripe client secret so the app can confirm the card. The physician is
 * notified only after Stripe confirms the hold (see stripeWebhook).
 */
export const createRequest = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const b = body(e);
  if (b.emergencyAcknowledged !== true) {
    throw new v.ValidationError("Please confirm this is not an emergency. If it is, call 911.");
  }
  const patientState = v.state(b.patientState, "Your current location");
  const ageGroup = v.ageGroup(b.ageGroup);
  const specialty = v.specialty(b.specialty);
  const provider = await getProvider(v.str(b.providerId, "Physician", 60));
  if (!provider || !isEligible(provider, { patientState, ageGroup, specialty, today: todayIso() })) {
    throw new HttpError(409, "That physician isn't available for you right now. Pick another one.");
  }
  const priced = quote(provider.visitPriceCents);
  const at = nowIso();
  const r: CareRequest = {
    requestId: newId("req"),
    patientUserId: c.userId,
    patientState,
    ageGroup,
    specialty,
    chiefComplaint: v.str(b.chiefComplaint, "What's going on", 500),
    symptomDuration: v.str(b.symptomDuration, "When it started", 40),
    requestedProviderId: provider.providerId,
    status: "REQUESTED",
    visitPriceCents: priced.visitPriceCents,
    bookingFeeCents: priced.bookingFeeCents,
    patientContact: { email: claim(e, "email"), phone: claim(e, "phone_number") },
    createdAt: at,
    updatedAt: at,
    expiresAt: Math.floor(Date.now() / 1000) + REQUEST_TTL_SECONDS,
  };
  if (!provider.stripeAccountId) throw new HttpError(409, "That physician can't take payments yet.");
  const pay = await authorizeVisit({ quote: priced, physicianAccountId: provider.stripeAccountId, requestId: r.requestId });
  r.paymentIntentId = pay.paymentIntentId;

  await ddb.send(new PutCommand({ TableName: tables.requests, Item: r, ConditionExpression: "attribute_not_exists(requestId)" }));
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "CARE_REQUEST_CREATED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
  return json(201, {
    requestId: r.requestId,
    status: r.status,
    quote: priced,
    paymentClientSecret: pay.clientSecret,
    physician: publicProfile(provider),
  });
});

async function ownRequest(e: Event, userId: string): Promise<CareRequest> {
  const id = e.pathParameters?.id;
  if (!id) throw new HttpError(400, "Missing request id.");
  const r = (await ddb.send(new GetCommand({ TableName: tables.requests, Key: { requestId: id } }))).Item as CareRequest | undefined;
  // Same answer for "doesn't exist" and "not yours", so ids can't be probed.
  if (!r || r.patientUserId !== userId) throw new HttpError(404, "Request not found.");
  return r;
}

/** GET /patient/requests/{id} */
export const getRequest = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const r = await ownRequest(e, c.userId);
  const p = r.matchedProviderId ? await getProvider(r.matchedProviderId) : undefined;
  return json(200, {
    requestId: r.requestId,
    status: r.status,
    visitPriceCents: r.visitPriceCents,
    bookingFeeCents: r.bookingFeeCents,
    physician: p ? publicProfile(p) : null,
    updatedAt: r.updatedAt,
  });
});

/** POST /patient/requests/{id}/cancel — releases the card hold. */
export const cancelRequest = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const r = await ownRequest(e, c.userId);
  assertRequestTransition(r.status, "CANCELLED");
  await ddb.send(
    new UpdateCommand({
      TableName: tables.requests,
      Key: { requestId: r.requestId },
      UpdateExpression: "SET #s = :c, updatedAt = :at REMOVE openState",
      ConditionExpression: "#s = :from",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":c": "CANCELLED", ":from": r.status, ":at": nowIso() },
    }),
  );
  if (r.paymentIntentId) await releaseVisit(r.paymentIntentId);
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "CARE_REQUEST_CANCELLED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
  return json(200, { status: "CANCELLED" });
});
