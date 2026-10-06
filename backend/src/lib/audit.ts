import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, newId, nowIso, tables } from "./db.js";
import type { AuditEvent } from "../domain/types.js";

/**
 * Append-only audit log. The Lambda role may only PutItem on this table
 * (no Update/Delete), and the condition stops overwriting an existing event.
 */
export async function audit(e: Omit<AuditEvent, "eventId" | "at">): Promise<void> {
  const item: AuditEvent = { eventId: newId("evt"), at: nowIso(), ...e };
  await ddb.send(
    new PutCommand({
      TableName: tables.audit,
      Item: { pk: `${e.resourceType}#${e.resourceId}`, sk: `${item.at}#${item.eventId}`, ...item },
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  );
}
