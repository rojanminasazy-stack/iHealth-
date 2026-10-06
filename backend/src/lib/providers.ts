import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, nowIso, tables } from "./db.js";
import type { Provider } from "../domain/types.js";
import { HttpError } from "./http.js";
import { activationBlockers } from "../domain/stateMachines.js";
import { audit } from "./audit.js";

export async function getProvider(providerId: string): Promise<Provider | undefined> {
  const r = await ddb.send(new GetCommand({ TableName: tables.providers, Key: { providerId } }));
  return r.Item as Provider | undefined;
}

export async function providerForUser(userId: string): Promise<Provider | undefined> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: tables.providers,
      IndexName: "byUser",
      KeyConditionExpression: "userId = :u",
      ExpressionAttributeValues: { ":u": userId },
      Limit: 1,
    }),
  );
  return r.Items?.[0] as Provider | undefined;
}

export async function requireProviderForUser(userId: string): Promise<Provider> {
  const p = await providerForUser(userId);
  if (!p) throw new HttpError(404, "No physician application found for this account.");
  return p;
}

export async function providersByStatus(status: Provider["status"]): Promise<Provider[]> {
  const out: Provider[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tables.providers,
        IndexName: "byStatus",
        KeyConditionExpression: "#s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": status },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((r.Items ?? []) as Provider[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** Moves an APPROVED physician to ACTIVE once license, BAA and payouts are all in place. */
export async function tryActivate(p: Provider): Promise<Provider> {
  if (p.status !== "APPROVED") return p;
  if (activationBlockers(p).length > 0) return p;
  const at = nowIso();
  await ddb.send(
    new UpdateCommand({
      TableName: tables.providers,
      Key: { providerId: p.providerId },
      UpdateExpression: "SET #s = :active, updatedAt = :at",
      ConditionExpression: "#s = :approved",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":active": "ACTIVE", ":approved": "APPROVED", ":at": at },
    }),
  );
  await audit({
    actorId: "system",
    actorRole: "SYSTEM",
    action: "PROVIDER_ACTIVATED",
    resourceType: "PROVIDER",
    resourceId: p.providerId,
    result: "ALLOWED",
  });
  return { ...p, status: "ACTIVE", updatedAt: at };
}

/** What a patient may see about a physician before booking. No license numbers, NPI or contact info. */
export function publicProfile(p: Provider) {
  return {
    providerId: p.providerId,
    name: `${p.fullName}, ${p.credentials}`,
    specialty: p.specialty,
    languages: p.languages,
    visitPriceCents: p.visitPriceCents,
    rating: p.rating ?? null,
    verified: true,
  };
}
