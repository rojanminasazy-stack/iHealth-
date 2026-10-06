import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { body, caller, handler, HttpError, json, requireGroup } from "../lib/http.js";
import { ddb, nowIso, tables } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { getProvider, providersByStatus, tryActivate } from "../lib/providers.js";
import { assertProviderTransition } from "../domain/stateMachines.js";
import { subscriptionPlanFor } from "../domain/fees.js";
import * as v from "../domain/validation.js";
import type { Provider, ProviderStatus } from "../domain/types.js";

/** Staff must be in the Cognito "credentialing" group (MFA is enforced on the staff pool). */
const GROUP = "credentialing";
const s3 = new S3Client({});

async function load(id: string | undefined): Promise<Provider> {
  if (!id) throw new HttpError(400, "Missing physician id.");
  const p = await getProvider(id);
  if (!p) throw new HttpError(404, "Physician not found.");
  return p;
}

async function setStatus(p: Provider, to: ProviderStatus, extra: Record<string, unknown> = {}) {
  assertProviderTransition(p.status, to);
  const names: Record<string, string> = { "#s": "status" };
  const values: Record<string, unknown> = { ":to": to, ":from": p.status, ":at": nowIso() };
  let set = "#s = :to, updatedAt = :at";
  for (const [k, val] of Object.entries(extra)) {
    names[`#${k}`] = k;
    values[`:${k}`] = val;
    set += `, #${k} = :${k}`;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: tables.providers,
      Key: { providerId: p.providerId },
      UpdateExpression: `SET ${set}`,
      ConditionExpression: "#s = :from",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** GET /staff/providers?status=APPLIED */
export const queue = handler(async (e) => {
  const c = caller(e, "STAFF");
  requireGroup(c, GROUP);
  const status = (e.queryStringParameters?.status ?? "APPLIED") as ProviderStatus;
  const list = await providersByStatus(status);
  return json(200, {
    providers: list.map((p) => ({
      providerId: p.providerId,
      fullName: p.fullName,
      credentials: p.credentials,
      npi: p.npi,
      specialty: p.specialty,
      licenses: p.licenses,
      status: p.status,
      resumeUploaded: !!p.resumeKey,
      createdAt: p.createdAt,
    })),
  });
});

/** GET /staff/providers/{id}/resume — 2-minute view link, audited. */
export const resume = handler(async (e) => {
  const c = caller(e, "STAFF");
  requireGroup(c, GROUP);
  const p = await load(e.pathParameters?.id);
  if (!p.resumeKey) throw new HttpError(404, "No resume uploaded yet.");
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.DOCUMENTS_BUCKET, Key: p.resumeKey }), { expiresIn: 120 });
  return json(200, { url });
});

/** POST /staff/providers/{id}/review — moves APPLIED → UNDER_REVIEW. */
export const startReview = handler(async (e) => {
  const c = caller(e, "STAFF");
  requireGroup(c, GROUP);
  const p = await load(e.pathParameters?.id);
  await setStatus(p, "UNDER_REVIEW");
  await audit({ actorId: c.userId, actorRole: "STAFF", action: "PROVIDER_REVIEW_STARTED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED" });
  return json(200, { status: "UNDER_REVIEW" });
});

/**
 * POST /staff/providers/{id}/licenses/{state}/verify
 * Staff confirm the license on the state medical board website and record where they checked.
 */
export const verifyLicense = handler(async (e) => {
  const c = caller(e, "STAFF");
  requireGroup(c, GROUP);
  const p = await load(e.pathParameters?.id);
  const st = v.state(e.pathParameters?.state);
  const b = body(e);
  const source = v.str(b.source, "Verification source", 200);
  const idx = p.licenses.findIndex((l) => l.state === st);
  if (idx < 0) throw new HttpError(404, `This physician has no ${st} license on file.`);
  const expiresOn = b.expiresOn === undefined ? p.licenses[idx]!.expiresOn : v.isoDate(b.expiresOn, "License expiration");
  const at = nowIso();
  await ddb.send(
    new UpdateCommand({
      TableName: tables.providers,
      Key: { providerId: p.providerId },
      UpdateExpression: `SET licenses[${idx}].verifiedAt = :at, licenses[${idx}].verifiedBy = :by, licenses[${idx}].expiresOn = :exp, licenses[${idx}].verificationSource = :src, updatedAt = :at`,
      ExpressionAttributeValues: { ":at": at, ":by": c.userId, ":exp": expiresOn, ":src": source },
    }),
  );
  await audit({ actorId: c.userId, actorRole: "STAFF", action: "PROVIDER_LICENSE_VERIFIED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED", reason: `${st} via ${source}` });
  return json(200, { state: st, verifiedAt: at });
});

/** POST /staff/providers/{id}/approve — requires at least one verified license. Sends the approval email + text. */
export const approve = handler(async (e) => {
  const c = caller(e, "STAFF");
  requireGroup(c, GROUP);
  const p = await load(e.pathParameters?.id);
  if (!p.licenses.some((l) => l.verifiedAt)) throw new HttpError(409, "Verify at least one license before approving.");
  if (!p.resumeKey) throw new HttpError(409, "The physician hasn't uploaded a resume yet.");

  const foundingSeatsUsed = (await providersByStatus("ACTIVE")).filter((x) => x.founding).length +
    (await providersByStatus("APPROVED")).filter((x) => x.founding).length;
  const plan = subscriptionPlanFor(foundingSeatsUsed);
  await setStatus(p, "APPROVED", { founding: plan.label === "Founding Physician", approvedBy: c.userId });
  await audit({ actorId: c.userId, actorRole: "STAFF", action: "PROVIDER_APPROVED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED", reason: plan.label });
  await notify(p.contact, "PROVIDER_APPROVED");
  await tryActivate({ ...p, status: "APPROVED" });
  return json(200, { status: "APPROVED", plan });
});

/** POST /staff/providers/{id}/reject */
export const reject = handler(async (e) => {
  const c = caller(e, "STAFF");
  requireGroup(c, GROUP);
  const p = await load(e.pathParameters?.id);
  const reason = v.str(body(e).reason, "Reason", 500);
  await setStatus(p, "REJECTED", { online: false });
  await audit({ actorId: c.userId, actorRole: "STAFF", action: "PROVIDER_REJECTED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED", reason });
  await notify(p.contact, "PROVIDER_NOT_APPROVED");
  return json(200, { status: "REJECTED" });
});

/** POST /staff/providers/{id}/suspend — takes a physician offline immediately. */
export const suspend = handler(async (e) => {
  const c = caller(e, "STAFF");
  requireGroup(c, GROUP);
  const p = await load(e.pathParameters?.id);
  const reason = v.str(body(e).reason, "Reason", 500);
  await setStatus(p, "SUSPENDED", { online: false });
  await audit({ actorId: c.userId, actorRole: "STAFF", action: "PROVIDER_SUSPENDED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED", reason });
  return json(200, { status: "SUSPENDED" });
});
