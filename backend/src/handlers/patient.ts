import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { body, caller, handler, HttpError, json, type Event } from "../lib/http.js";
import { ddb, newId, nowIso, tables, todayIso } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { freeProvider, getProvider, providersByStatus, publicProfile } from "../lib/providers.js";
import { authorizeVisit, checkoutVisit, releaseVisit } from "../lib/payments.js";
import { isAvailableNow, offerExpired, speaks } from "../domain/dispatch.js";
import { notify } from "../lib/notify.js";
import { findEligible, isEligible } from "../domain/eligibility.js";
import { assertRequestTransition } from "../domain/stateMachines.js";
import { patientVisitView } from "./visit.js";
import { getPatientProfile } from "./profile.js";
import { quote } from "../domain/fees.js";
import * as v from "../domain/validation.js";
import type { CareRequest } from "../domain/types.js";

const REQUEST_TTL_SECONDS = 30 * 60;

function claim(e: Event, name: string): string | undefined {
  const c = e.requestContext.authorizer?.jwt?.claims?.[name];
  return typeof c === "string" ? c : undefined;
}

/**
 * GET /patient/physicians?state=CA&specialty=FAMILY_MEDICINE&ageGroup=ADULT&language=fa&onlyLanguage=1
 * Lists physicians who may legally see this patient right now, best match first.
 * With onlyLanguage=1, lists only physicians who speak that language.
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
  const now = Date.now();
  const language = q.language ? v.language(q.language) : undefined;
  const onlyLanguage = q.onlyLanguage === "1" ? language : undefined;
  const ranked = findEligible(await providersByStatus("ACTIVE"), query, { preferredLanguage: language }).filter(
    (p) => isAvailableNow(p, now) && speaks(p, onlyLanguage),
  );
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "PROVIDER_LIST_VIEWED", resourceType: "PROVIDER", resourceId: `list:${query.patientState}`, result: "ALLOWED" });
  return json(200, {
    physicians: ranked.slice(0, 50).map((p) => ({ ...publicProfile(p), quote: quote() })),
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
  const profile = await getPatientProfile(c.userId);
  if (!profile) throw new HttpError(409, "Please finish the About you questions first.");
  const patientState = v.state(b.patientState, "Your current location");
  const ageGroup = "ADULT" as const; // accounts are 18+; derived from date of birth on the profile
  const specialty = v.specialty(b.specialty);
  const eligibility = { patientState, ageGroup, specialty, today: todayIso() };
  const now = Date.now();
  // Uber-style: no physician chosen means "first available". A chosen physician must be available now.
  // Language match: when set, only doctors who speak this language are offered the visit.
  const language = b.language ? v.language(b.language) : undefined;
  const languageLabel = language ? (LANGUAGE_NAMES[language] ?? language) : "";
  const chosenId = b.providerId === undefined || b.providerId === null || b.providerId === "" ? undefined : v.str(b.providerId, "Physician", 60);
  const provider = chosenId ? await getProvider(chosenId) : undefined;
  if (chosenId && (!provider || !isEligible(provider, eligibility) || !isAvailableNow(provider, now))) {
    throw new HttpError(409, "That physician just went offline. Tap See a doctor now and we'll find you someone else.");
  }
  if (provider && !speaks(provider, language)) {
    throw new HttpError(409, `That physician doesn't list ${languageLabel}. Choose another doctor or turn off the language match.`);
  }
  if (!chosenId) {
    const available = findEligible(await providersByStatus("ACTIVE"), eligibility).filter((p) => isAvailableNow(p, now) && speaks(p, language));
    if (available.length === 0) {
      throw new HttpError(
        409,
        language
          ? `No ${languageLabel}-speaking physicians licensed in ${patientState} are online right now. Try again soon, or turn off the language match to see any available doctor.`
          : `No physicians licensed in ${patientState} are online right now. Please try again in a few minutes.`,
      );
    }
  }
  const priced = quote();
  const at = nowIso();
  const r: CareRequest = {
    requestId: newId("req"),
    patientUserId: c.userId,
    patientState,
    ageGroup,
    specialty,
    chiefComplaint: v.str(b.chiefComplaint, "Reason for your visit", 500),
    symptomDuration: v.str(b.symptomDuration, "When it started", 40),
    requestedProviderId: provider?.providerId,
    language,
    status: "REQUESTED",
    visitPriceCents: priced.visitPriceCents,
    bookingFeeCents: priced.bookingFeeCents,
    patientContact: { email: claim(e, "email"), phone: claim(e, "phone_number") ?? profile.phone },
    createdAt: at,
    updatedAt: at,
    expiresAt: Math.floor(Date.now() / 1000) + REQUEST_TTL_SECONDS,
  };
  // Card hold: native apps use Stripe's in-app payment sheet; the website uses Stripe's hosted checkout.
  const web = b.client === "web";
  let paymentClientSecret: string | undefined;
  let checkoutUrl: string | undefined;
  if (web) {
    checkoutUrl = await checkoutVisit({ quote: priced, requestId: r.requestId, email: r.patientContact.email, returnUrl: `${process.env.APP_URL ?? "https://ihealthe.net"}/app/request/${r.requestId}` });
  } else {
    const pay = await authorizeVisit({ quote: priced, requestId: r.requestId });
    r.paymentIntentId = pay.paymentIntentId;
    paymentClientSecret = pay.clientSecret;
  }

  await ddb.send(new PutCommand({ TableName: tables.requests, Item: r, ConditionExpression: "attribute_not_exists(requestId)" }));
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "CARE_REQUEST_CREATED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
  return json(201, {
    requestId: r.requestId,
    status: r.status,
    quote: priced,
    paymentClientSecret,
    checkoutUrl,
    physician: provider ? publicProfile(provider) : null,
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
  let r = await ownRequest(e, c.userId);
  if ((r.status === "OFFERED" || r.status === "REQUESTED") && offerExpired(r, Date.now())) r = await expire(r);
  return json(200, await patientVisitView(r));
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
      UpdateExpression: "SET #s = :c, updatedAt = :at REMOVE openState, activeProviderId",
      ConditionExpression: "#s = :from",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":c": "CANCELLED", ":from": r.status, ":at": nowIso() },
    }),
  );
  if (r.paymentIntentId) await releaseVisit(r.paymentIntentId);
  if (r.matchedProviderId) await freeProvider(r.matchedProviderId, r.requestId);
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "CARE_REQUEST_CANCELLED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
  return json(200, { status: "CANCELLED" });
});

/** Nobody accepted in time: stop searching, release the card hold, and let the patient know. */
async function expire(r: CareRequest): Promise<CareRequest> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tables.requests,
        Key: { requestId: r.requestId },
        UpdateExpression: "SET #s = :x, updatedAt = :at REMOVE openState",
        ConditionExpression: "#s = :from",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":x": "EXPIRED", ":from": r.status, ":at": nowIso() },
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return r;
    throw err;
  }
  if (r.paymentIntentId) await releaseVisit(r.paymentIntentId).catch(() => undefined);
  await audit({ actorId: "system", actorRole: "SYSTEM", action: "PAYMENT_RELEASED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED", reason: "no physician accepted in time" });
  await notify(r.patientContact, "REQUEST_EXPIRED");
  return { ...r, status: "EXPIRED" };
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", zh: "Mandarin", yue: "Cantonese", tl: "Tagalog", vi: "Vietnamese", ko: "Korean",
  hy: "Armenian", fa: "Farsi", ar: "Arabic", ru: "Russian", hi: "Hindi", pa: "Punjabi", ja: "Japanese",
  fr: "French", pt: "Portuguese", ase: "American Sign Language",
};
