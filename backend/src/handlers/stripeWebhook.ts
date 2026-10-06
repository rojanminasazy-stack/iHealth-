import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyWebhook } from "../lib/payments.js";
import { ddb, nowIso, tables } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { getProvider, tryActivate } from "../lib/providers.js";
import type { CareRequest, Provider } from "../domain/types.js";

/**
 * POST /webhooks/stripe — public route, trusted only after signature verification.
 *  - account.updated: physician finished payout setup → may activate.
 *  - payment_intent.amount_capturable_updated: patient's card hold succeeded → offer to physician.
 */
export const main = async (e: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const sig = e.headers["stripe-signature"];
  if (!sig || !e.body) return { statusCode: 400 };
  const raw = e.isBase64Encoded ? Buffer.from(e.body, "base64").toString("utf8") : e.body;
  let evt;
  try {
    evt = verifyWebhook(raw, sig);
  } catch {
    return { statusCode: 400 };
  }

  if (evt.type === "account.updated") {
    const acct = evt.data.object;
    const r = await ddb.send(
      new QueryCommand({
        TableName: tables.providers,
        IndexName: "byStripeAccount",
        KeyConditionExpression: "stripeAccountId = :a",
        ExpressionAttributeValues: { ":a": acct.id },
        Limit: 1,
      }),
    );
    const p = r.Items?.[0] as Provider | undefined;
    if (p) {
      const enabled = acct.charges_enabled === true && acct.payouts_enabled === true;
      await ddb.send(
        new UpdateCommand({
          TableName: tables.providers,
          Key: { providerId: p.providerId },
          UpdateExpression: "SET stripeChargesEnabled = :e, updatedAt = :at",
          ExpressionAttributeValues: { ":e": enabled, ":at": nowIso() },
        }),
      );
      if (enabled) await tryActivate({ ...p, stripeChargesEnabled: true });
    }
  }

  if (evt.type === "payment_intent.amount_capturable_updated") {
    const requestId = evt.data.object.metadata?.request_id;
    if (requestId) {
      const got = await ddb.send(new GetCommand({ TableName: tables.requests, Key: { requestId } }));
      const req = got.Item as CareRequest | undefined;
      if (req && req.status === "REQUESTED") {
        try {
          await ddb.send(
            new UpdateCommand({
              TableName: tables.requests,
              Key: { requestId },
              UpdateExpression: "SET #s = :o, openState = :st, updatedAt = :at",
              ConditionExpression: "#s = :r",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: { ":o": "OFFERED", ":r": "REQUESTED", ":st": req.patientState, ":at": nowIso() },
            }),
          );
        } catch (err) {
          if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
          return { statusCode: 200 }; // already processed (Stripe retries are normal)
        }
        await audit({ actorId: "stripe", actorRole: "SYSTEM", action: "PAYMENT_AUTHORIZED", resourceType: "CARE_REQUEST", resourceId: requestId, result: "ALLOWED" });
        await notify(req.patientContact, "REQUEST_RECEIVED");
        const p = await getProvider(req.requestedProviderId);
        if (p) await notify(p.contact, "PROVIDER_NEW_REQUEST");
      }
    }
  }

  return { statusCode: 200 };
};
