import { PutCommand, UpdateCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { body, caller, handler, HttpError, json, type Event } from "../lib/http.js";
import { ddb, newId, nowIso, tables, todayIso } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { requireProviderForUser, providerForUser, tryActivate } from "../lib/providers.js";
import { createPhysicianAccount, onboardingLink } from "../lib/payments.js";
import * as v from "../domain/validation.js";
import { validateVisitPrice, FEES } from "../domain/fees.js";
import { activationBlockers } from "../domain/stateMachines.js";
import { isEligible } from "../domain/eligibility.js";
import type { CareRequest, Provider } from "../domain/types.js";

const s3 = new S3Client({});

function claim(e: Event, name: string): string | undefined {
  const c = e.requestContext.authorizer?.jwt?.claims?.[name];
  return typeof c === "string" ? c : undefined;
}

/** What the physician sees about their own account. */
function selfView(p: Provider) {
  return {
    providerId: p.providerId,
    fullName: p.fullName,
    credentials: p.credentials,
    specialty: p.specialty,
    status: p.status,
    online: p.online,
    visitPriceCents: p.visitPriceCents,
    licenses: p.licenses.map((l) => ({ state: l.state, number: l.number, expiresOn: l.expiresOn, verified: !!l.verifiedAt })),
    baaSigned: !!p.baaSignedAt,
    payoutsReady: p.stripeChargesEnabled,
    resumeUploaded: !!p.resumeKey,
    founding: p.founding,
    nextSteps: p.status === "APPROVED" ? activationBlockers(p) : [],
  };
}

/** POST /physician/application — submit name, NPI, license(s), specialty, price. */
export const apply = handler(async (e) => {
  const me = caller(e, "PHYSICIAN");
  if (await providerForUser(me.userId)) throw new HttpError(409, "You've already applied. Check your status in the app.");
  const b = body(e);
  const licensesIn = Array.isArray(b.licenses) ? b.licenses : [];
  if (licensesIn.length === 0 || licensesIn.length > 10) throw new v.ValidationError("Add between 1 and 10 state licenses.");
  const licenses = licensesIn.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return {
      state: v.state(o.state, "License state"),
      number: v.licenseNumber(o.number),
      expiresOn: v.isoDate(o.expiresOn, "License expiration"),
    };
  });
  if (licenses.some((l) => l.expiresOn < todayIso())) throw new v.ValidationError("One of your licenses is already expired.");
  const visitPriceCents = Number(b.visitPriceCents ?? 7_900);
  validateVisitPrice(visitPriceCents);

  const at = nowIso();
  const p: Provider = {
    providerId: newId("prv"),
    userId: me.userId,
    fullName: v.str(b.fullName, "Full name", 120),
    credentials: v.str(b.credentials, "Credentials", 20),
    npi: v.npi(b.npi),
    specialty: v.specialty(b.specialty),
    languages: Array.isArray(b.languages) ? b.languages.slice(0, 10).map((x) => v.str(x, "Language", 30)) : ["en"],
    licenses,
    status: "APPLIED",
    visitPriceCents,
    online: false,
    acceptsPediatric: b.acceptsPediatric === true,
    stripeChargesEnabled: false,
    founding: false,
    contact: { email: claim(e, "email"), phone: claim(e, "phone_number") },
    createdAt: at,
    updatedAt: at,
  };
  await ddb.send(new PutCommand({ TableName: tables.providers, Item: p, ConditionExpression: "attribute_not_exists(providerId)" }));
  await audit({ actorId: me.userId, actorRole: "PHYSICIAN", action: "PROVIDER_APPLIED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED" });
  await notify(p.contact, "PROVIDER_APPLICATION_RECEIVED");
  return json(201, selfView(p));
});

/** GET /physician/me */
export const me = handler(async (e) => {
  const p = await requireProviderForUser(caller(e, "PHYSICIAN").userId);
  return json(200, selfView(p));
});

/** POST /physician/resume-upload — returns a 5-minute upload link for a PDF resume. */
export const resumeUploadUrl = handler(async (e) => {
  const p = await requireProviderForUser(caller(e, "PHYSICIAN").userId);
  const key = `providers/${p.providerId}/resume/${newId("doc")}.pdf`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET,
      Key: key,
      ContentType: "application/pdf",
      // Encryption comes from the bucket's default KMS key, so the app doesn't need to send key headers.
    }),
    { expiresIn: 300 },
  );
  await ddb.send(
    new UpdateCommand({
      TableName: tables.providers,
      Key: { providerId: p.providerId },
      UpdateExpression: "SET resumeKey = :k, updatedAt = :at",
      ExpressionAttributeValues: { ":k": key, ":at": nowIso() },
    }),
  );
  return json(200, { uploadUrl: url, contentType: "application/pdf", maxBytes: 10 * 1024 * 1024 });
});

/** POST /physician/baa — physician accepts the Business Associate Agreement (version recorded). */
export const signBaa = handler(async (e) => {
  const c = caller(e, "PHYSICIAN");
  const p = await requireProviderForUser(c.userId);
  const b = body(e);
  if (b.accept !== true) throw new v.ValidationError("You must accept the agreement to continue.");
  const version = v.str(b.version, "Agreement version", 20);
  const at = nowIso();
  await ddb.send(
    new UpdateCommand({
      TableName: tables.providers,
      Key: { providerId: p.providerId },
      UpdateExpression: "SET baaSignedAt = :at, baaVersion = :v, updatedAt = :at",
      ExpressionAttributeValues: { ":at": at, ":v": version },
    }),
  );
  await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "PROVIDER_BAA_SIGNED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED", reason: `version ${version}` });
  const updated = await tryActivate({ ...p, baaSignedAt: at });
  return json(200, selfView(updated));
});

/** POST /physician/payouts — creates (once) a Stripe Express account and returns the setup link. */
export const payoutsLink = handler(async (e) => {
  const c = caller(e, "PHYSICIAN");
  const p = await requireProviderForUser(c.userId);
  if (p.status !== "APPROVED" && p.status !== "ACTIVE") throw new HttpError(409, "Payouts open after your application is approved.");
  let accountId = p.stripeAccountId;
  if (!accountId) {
    const email = claim(e, "email");
    if (!email) throw new HttpError(400, "Add an email to your account first.");
    accountId = await createPhysicianAccount(email);
    await ddb.send(
      new UpdateCommand({
        TableName: tables.providers,
        Key: { providerId: p.providerId },
        UpdateExpression: "SET stripeAccountId = :a, updatedAt = :at",
        ConditionExpression: "attribute_not_exists(stripeAccountId)",
        ExpressionAttributeValues: { ":a": accountId, ":at": nowIso() },
      }),
    );
  }
  const base = process.env.APP_URL ?? "https://ihealthe.net";
  const url = await onboardingLink(accountId, `${base}/pro/payouts/done`, `${base}/pro/payouts/retry`);
  return json(200, { url });
});

/** PUT /physician/price — physician sets their own visit price. */
export const setPrice = handler(async (e) => {
  const p = await requireProviderForUser(caller(e, "PHYSICIAN").userId);
  const cents = Number(body(e).visitPriceCents);
  validateVisitPrice(cents);
  await ddb.send(
    new UpdateCommand({
      TableName: tables.providers,
      Key: { providerId: p.providerId },
      UpdateExpression: "SET visitPriceCents = :c, updatedAt = :at",
      ExpressionAttributeValues: { ":c": cents, ":at": nowIso() },
    }),
  );
  return json(200, { visitPriceCents: cents, bookingFeeCents: FEES.bookingFeeCents });
});

/** POST /physician/online — go online or offline. Only ACTIVE physicians may go online. */
export const setOnline = handler(async (e) => {
  const c = caller(e, "PHYSICIAN");
  const p = await requireProviderForUser(c.userId);
  const online = body(e).online === true;
  if (online && p.status !== "ACTIVE") {
    throw new HttpError(409, `You can't go online yet: ${activationBlockers(p).join(", ") || "account not active"}.`);
  }
  await ddb.send(
    new UpdateCommand({
      TableName: tables.providers,
      Key: { providerId: p.providerId },
      UpdateExpression: "SET online = :o, updatedAt = :at",
      ExpressionAttributeValues: { ":o": online, ":at": nowIso() },
    }),
  );
  await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: online ? "PROVIDER_ONLINE" : "PROVIDER_OFFLINE", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED" });
  return json(200, { online });
});

/**
 * GET /physician/requests — open requests this physician may take.
 * Shows only what's needed to decide: age group, specialty, short complaint, state, pay.
 */
export const openRequests = handler(async (e) => {
  const p = await requireProviderForUser(caller(e, "PHYSICIAN").userId);
  if (p.status !== "ACTIVE" || !p.online) return json(200, { requests: [] });
  const states = p.licenses.filter((l) => l.verifiedAt && l.expiresOn >= todayIso()).map((l) => l.state);
  const out: unknown[] = [];
  for (const st of states) {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tables.requests,
        IndexName: "openByState",
        KeyConditionExpression: "openState = :s",
        ExpressionAttributeValues: { ":s": st },
        Limit: 50,
      }),
    );
    for (const item of (r.Items ?? []) as CareRequest[]) {
      if (item.requestedProviderId !== p.providerId) continue;
      if (!isEligible(p, { patientState: item.patientState, ageGroup: item.ageGroup, specialty: item.specialty, today: todayIso() })) continue;
      out.push({
        requestId: item.requestId,
        ageGroup: item.ageGroup,
        specialty: item.specialty,
        patientState: item.patientState,
        chiefComplaint: item.chiefComplaint.slice(0, 80),
        symptomDuration: item.symptomDuration,
        youReceiveCents: p.visitPriceCents,
        createdAt: item.createdAt,
      });
    }
  }
  return json(200, { requests: out });
});

/**
 * POST /physician/requests/{id}/accept — atomic. Re-checks eligibility on the server,
 * then a conditional write guarantees only one physician wins.
 */
export const accept = handler(async (e) => {
  const c = caller(e, "PHYSICIAN");
  const p = await requireProviderForUser(c.userId);
  const requestId = e.pathParameters?.id;
  if (!requestId) throw new HttpError(400, "Missing request id.");
  const got = await ddb.send(new GetCommand({ TableName: tables.requests, Key: { requestId } }));
  const r = got.Item as CareRequest | undefined;
  if (!r) throw new HttpError(404, "That request no longer exists.");

  const ok = isEligible(p, { patientState: r.patientState, ageGroup: r.ageGroup, specialty: r.specialty, today: todayIso() }) &&
    r.requestedProviderId === p.providerId;
  if (!ok) {
    await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "CARE_REQUEST_ACCEPT_REJECTED", resourceType: "CARE_REQUEST", resourceId: requestId, result: "DENIED", reason: "not eligible" });
    throw new HttpError(403, "You're not eligible to accept this request.");
  }

  const at = nowIso();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tables.requests,
        Key: { requestId },
        UpdateExpression: "SET #s = :matched, matchedProviderId = :p, updatedAt = :at REMOVE openState",
        // Only a paid-for, still-open request can be accepted.
        ConditionExpression: "#s = :offered AND attribute_exists(openState)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":matched": "MATCHED", ":p": p.providerId, ":at": at, ":offered": "OFFERED" },
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new HttpError(409, "Another physician already accepted this request.");
    }
    throw err;
  }
  await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "CARE_REQUEST_ACCEPTED", resourceType: "CARE_REQUEST", resourceId: requestId, result: "ALLOWED" });
  await notify(r.patientContact, "VISIT_CONFIRMED");
  return json(200, { requestId, status: "MATCHED" });
});
