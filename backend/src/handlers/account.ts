import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { caller, handler, HttpError, json, type Event } from "../lib/http.js";
import { ddb, tables } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import type { CareRequest } from "../domain/types.js";

const cognito = new CognitoIdentityProviderClient({});
const OPEN: CareRequest["status"][] = ["REQUESTED", "OFFERED", "MATCHED", "IN_VISIT"];

/**
 * POST /patient/account/delete
 * Closes the patient's account: removes their "About you" details and their sign-in.
 * Visit records stay, because physicians must keep medical records for a period set by law.
 * DRAFT POLICY: the attorney sets the retention period; this only removes what can go now.
 */
export const deleteAccount = handler(async (e: Event) => {
  const c = caller(e, "PATIENT");
  const username = e.requestContext.authorizer?.jwt?.claims?.["cognito:username"];
  if (typeof username !== "string" || !username) throw new HttpError(401, "Sign in again, then try deleting your account.");

  const r = await ddb.send(
    new QueryCommand({
      TableName: tables.requests,
      IndexName: "byPatient",
      KeyConditionExpression: "patientUserId = :u",
      ExpressionAttributeValues: { ":u": c.userId },
      ScanIndexForward: false,
      Limit: 25,
    }),
  );
  if ((r.Items as CareRequest[] | undefined)?.some((x) => OPEN.includes(x.status))) {
    throw new HttpError(409, "You have a visit in progress. Finish or cancel it, then delete your account.");
  }

  await ddb.send(new DeleteCommand({ TableName: tables.patients, Key: { userId: c.userId } }));
  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "PATIENT_ACCOUNT_DELETED", resourceType: "PATIENT", resourceId: c.userId, result: "ALLOWED" });
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.PATIENT_POOL_ID!, Username: username }));
  return json(200, { deleted: true });
});
