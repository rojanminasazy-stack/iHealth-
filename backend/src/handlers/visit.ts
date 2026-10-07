import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { body, caller, handler, HttpError, json, type Event } from "../lib/http.js";
import { ddb, nowIso, tables } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { getProvider, publicProfile, requireProviderForUser } from "../lib/providers.js";
import { addAttendee, endMeeting, ensureMeeting } from "../lib/video.js";
import { captureVisit } from "../lib/payments.js";
import { assertRequestTransition } from "../domain/stateMachines.js";
import * as v from "../domain/validation.js";
import type { CareRequest } from "../domain/types.js";

async function load(e: Event): Promise<CareRequest> {
  const id = e.pathParameters?.id;
  if (!id) throw new HttpError(400, "Missing visit id.");
  const r = (await ddb.send(new GetCommand({ TableName: tables.requests, Key: { requestId: id } }))).Item as CareRequest | undefined;
  if (!r) throw new HttpError(404, "Visit not found.");
  return r;
}

async function saveMeeting(r: CareRequest, meetingId: string) {
  if (r.meetingId === meetingId) return;
  await ddb.send(
    new UpdateCommand({
      TableName: tables.requests,
      Key: { requestId: r.requestId },
      UpdateExpression: "SET meetingId = :m, updatedAt = :at",
      ExpressionAttributeValues: { ":m": meetingId, ":at": nowIso() },
    }),
  );
}

/**
 * POST /physician/visits/{id}/join — only the matched physician. Starts the visit
 * (MATCHED → IN_VISIT) and tells the patient their physician is ready.
 */
export const physicianJoin = handler(async (e) => {
  const c = caller(e, "PHYSICIAN");
  const p = await requireProviderForUser(c.userId);
  const r = await load(e);
  if (r.matchedProviderId !== p.providerId) {
    await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "VISIT_JOINED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "DENIED", reason: "not assigned" });
    throw new HttpError(404, "Visit not found.");
  }
  if (r.status !== "MATCHED" && r.status !== "IN_VISIT") throw new HttpError(409, "This visit has already ended.");

  const meeting = await ensureMeeting(r.requestId, r.meetingId);
  await saveMeeting(r, meeting.MeetingId!);
  if (r.status === "MATCHED") {
    assertRequestTransition("MATCHED", "IN_VISIT");
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: tables.requests,
          Key: { requestId: r.requestId },
          UpdateExpression: "SET #s = :iv, startedAt = :at, updatedAt = :at",
          ConditionExpression: "#s = :m",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":iv": "IN_VISIT", ":m": "MATCHED", ":at": nowIso() },
        }),
      );
      await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "VISIT_STARTED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
      await notify(r.patientContact, "VISIT_READY");
    } catch (err) {
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
    }
  }
  const attendee = await addAttendee(meeting.MeetingId!, `physician-${p.providerId}`);
  await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "VISIT_JOINED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
  return json(200, { meeting: { Meeting: meeting }, attendee: { Attendee: attendee } });
});

/** POST /patient/requests/{id}/join — only the patient who booked, and only once the physician has started. */
export const patientJoin = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const r = await load(e);
  if (r.patientUserId !== c.userId) throw new HttpError(404, "Visit not found.");
  if (r.status === "MATCHED") throw new HttpError(409, "Your physician hasn't started the visit yet. We'll text you when they're ready.");
  if (r.status !== "IN_VISIT" || !r.meetingId) throw new HttpError(409, "This visit isn't open right now.");
  const meeting = await ensureMeeting(r.requestId, r.meetingId);
  await saveMeeting(r, meeting.MeetingId!);
  const attendee = await addAttendee(meeting.MeetingId!, `patient-${r.requestId}`);
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "VISIT_JOINED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
  return json(200, { meeting: { Meeting: meeting }, attendee: { Attendee: attendee } });
});

/** GET /physician/visits — this physician's accepted and in-progress visits. Full intake unlocks only here, after the match. */
export const physicianVisits = handler(async (e) => {
  const c = caller(e, "PHYSICIAN");
  const p = await requireProviderForUser(c.userId);
  const r = await ddb.send(
    new QueryCommand({
      TableName: tables.requests,
      IndexName: "byActiveProvider",
      KeyConditionExpression: "activeProviderId = :p",
      ExpressionAttributeValues: { ":p": p.providerId },
      ScanIndexForward: false,
      Limit: 20,
    }),
  );
  const visits = ((r.Items ?? []) as CareRequest[]).map((x) => ({
    requestId: x.requestId,
    status: x.status,
    ageGroup: x.ageGroup,
    specialty: x.specialty,
    patientState: x.patientState,
    chiefComplaint: x.chiefComplaint,
    symptomDuration: x.symptomDuration,
    createdAt: x.createdAt,
  }));
  if (visits.length) {
    await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "INTAKE_VIEWED", resourceType: "CARE_REQUEST", resourceId: visits.map((x) => x.requestId).join(",").slice(0, 900), result: "ALLOWED" });
  }
  return json(200, { visits });
});

/**
 * POST /physician/visits/{id}/complete — physician ends the visit and writes a short summary for the patient.
 * Captures the held card (visit price → physician, booking fee → iHealthé), ends the video room, sends the receipt.
 */
export const complete = handler(async (e) => {
  const c = caller(e, "PHYSICIAN");
  const p = await requireProviderForUser(c.userId);
  const r = await load(e);
  if (r.matchedProviderId !== p.providerId) throw new HttpError(404, "Visit not found.");
  assertRequestTransition(r.status, "COMPLETED");
  const summary = v.str(body(e).patientSummary, "Visit summary", 4000);
  const at = nowIso();
  await ddb.send(
    new UpdateCommand({
      TableName: tables.requests,
      Key: { requestId: r.requestId },
      UpdateExpression: "SET #s = :done, completedAt = :at, updatedAt = :at, patientSummary = :sum REMOVE activeProviderId, expiresAt",
      ConditionExpression: "#s = :iv",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":done": "COMPLETED", ":iv": "IN_VISIT", ":at": at, ":sum": summary },
    }),
  );
  await audit({ actorId: c.userId, actorRole: "PHYSICIAN", action: "VISIT_COMPLETED", resourceType: "CARE_REQUEST", resourceId: r.requestId, result: "ALLOWED" });
  if (r.meetingId) await endMeeting(r.meetingId);
  if (r.paymentIntentId) {
    await captureVisit(r.paymentIntentId);
    await audit({ actorId: "system", actorRole: "SYSTEM", action: "PAYMENT_CAPTURED", resourceType: "PAYMENT", resourceId: r.requestId, result: "ALLOWED" });
  }
  await notify(r.patientContact, "VISIT_RECEIPT");
  return json(200, { requestId: r.requestId, status: "COMPLETED" });
});

/** Patient-facing summary of a completed visit (used by GET /patient/requests/{id}). */
export async function patientVisitView(r: CareRequest) {
  const p = r.matchedProviderId ? await getProvider(r.matchedProviderId) : undefined;
  return {
    requestId: r.requestId,
    status: r.status,
    visitPriceCents: r.visitPriceCents,
    bookingFeeCents: r.bookingFeeCents,
    physician: p ? publicProfile(p) : null,
    patientSummary: r.status === "COMPLETED" ? (r.patientSummary ?? null) : null,
    completedAt: r.completedAt ?? null,
    updatedAt: r.updatedAt,
  };
}
