import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyWebhook } from "../lib/payments.js";
import { ddb, nowIso, tables, todayIso } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { getProvider, providersByStatus, tryActivate } from "../lib/providers.js";
import { canOffer } from "../domain/dispatch.js";
import type { CareRequest, Provider } from "../domain/types.js";

/**
 * POST /webhooks/stripe — public route, trusted only after signature verification.
 *  - account.updated: physician finished payout setup → may activate.
 *  - payment_intent.amount_capturable_updated: patient's card hold succeeded → offer to physician.
 *  - customer.subscription.*: physician subscription status → may activate, or stops new patients if canceled.
 */
export const main = async (e: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const sig = e.headers["stripe-signature"];
  if (!sig || !e.body) return { statusCode: 400 };
  const raw = e.isBase64Encoded ? Buffer.from(e.body, "base64").toString("utf8") : e.body;
  let evt;
  try {
    evt = await verifyWebhook(raw, sig);
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
              // Web checkout creates the payment after the request, so record its id here.
              UpdateExpression: "SET #s = :o, openState = :st, paymentIntentId = :pi, updatedAt = :at",
              ConditionExpression: "#s = :r",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: { ":o": "OFFERED", ":r": "REQUESTED", ":st": req.patientState, ":pi": evt.data.object.id, ":at": nowIso() },
            }),
          );
        } catch (err) {
          if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
          return { statusCode: 200 }; // already processed (Stripe retries are normal)
        }
        await audit({ actorId: "stripe", actorRole: "SYSTEM", action: "PAYMENT_AUTHORIZED", resourceType: "CARE_REQUEST", resourceId: requestId, result: "ALLOWED" });
        await notify(req.patientContact, "REQUEST_RECEIVED");
        // Ping the chosen physician, or (first available) every available physician who may take it.
        const now = Date.now();
        const targets = req.requestedProviderId
          ? [await getProvider(req.requestedProviderId)].filter((x): x is Provider => !!x)
          : (await providersByStatus("ACTIVE")).filter((p) => canOffer(p, { ...req, status: "OFFERED" }, todayIso(), now)).slice(0, 25);
        await Promise.all(targets.map((p) => notify(p.contact, "PROVIDER_NEW_REQUEST")));
      }
    }
  }

  if (
    evt.type === "customer.subscription.created" ||
    evt.type === "customer.subscription.updated" ||
    evt.type === "customer.subscription.deleted"
  ) {
    const sub = evt.data.object;
    const providerId = sub.metadata?.provider_id;
    const p = providerId ? await getProvider(providerId) : undefined;
    if (p) {
      const status = evt.type === "customer.subscription.deleted" ? "canceled" : sub.status;
      await ddb.send(
        new UpdateCommand({
          TableName: tables.providers,
          Key: { providerId: p.providerId },
          UpdateExpression: "SET subscriptionStatus = :s, updatedAt = :at",
          ExpressionAttributeValues: { ":s": status, ":at": nowIso() },
        }),
      );
      await audit({ actorId: "stripe", actorRole: "SYSTEM", action: "SUBSCRIPTION_UPDATED", resourceType: "PROVIDER", resourceId: p.providerId, result: "ALLOWED", reason: status });
      if (status === "past_due" && p.subscriptionStatus !== "past_due") await notify(p.contact, "PROVIDER_SUBSCRIPTION_PROBLEM");
      await tryActivate({ ...p, subscriptionStatus: status });
    }
  }

  return { statusCode: 200 };
};
