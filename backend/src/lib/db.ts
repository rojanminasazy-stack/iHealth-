import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const tables = {
  get providers() {
    return env("PROVIDERS_TABLE");
  },
  get requests() {
    return env("REQUESTS_TABLE");
  },
  get audit() {
    return env("AUDIT_TABLE");
  },
  get counters() {
    return env("COUNTERS_TABLE");
  },
};

/** Opaque, non-sequential ids so nobody can guess another record. */
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`;

export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);
