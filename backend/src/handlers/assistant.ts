import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { body, caller, handler, HttpError, json } from "../lib/http.js";
import { ddb, tables } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import {
  ASSISTANT,
  CRISIS_REPLY,
  EMERGENCY_REPLY,
  SYSTEM_PROMPT,
  cleanHistory,
  triage,
  withNotice,
} from "../domain/assistant.js";

/** Claude on Amazon Bedrock, inside iHealthé's own AWS account (covered by the AWS BAA). */
const MODEL_ID = process.env.ASSISTANT_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const bedrock = new BedrockRuntimeClient({});

/** Simple hourly limit per patient so the assistant can't be abused or run up costs. */
async function underLimit(userId: string): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tables.counters,
        Key: { name: `assistant#${userId}#${hour}` },
        UpdateExpression: "ADD #v :one SET expiresAt = if_not_exists(expiresAt, :exp)",
        ConditionExpression: "attribute_not_exists(#v) OR #v < :max",
        ExpressionAttributeNames: { "#v": "value" },
        ExpressionAttributeValues: { ":one": 1, ":max": ASSISTANT.maxQuestionsPerHour, ":exp": Math.floor(Date.now() / 1000) + 7200 },
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
    throw e;
  }
}

/**
 * POST /patient/assistant  { messages: [{ role: "user" | "assistant", content }] }
 * The app keeps the conversation on the phone and sends it each time. We don't store it.
 */
export const ask = handler(async (e) => {
  const c = caller(e, "PATIENT");
  const messages = cleanHistory(body(e).messages);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") throw new HttpError(400, "Type a question first.");

  // Safety first: emergencies and crisis messages never wait on the AI.
  const t = triage(last.content);
  if (t !== "OK") {
    await audit({ actorId: c.userId, actorRole: "PATIENT", action: "AI_ASSISTANT_USED", resourceType: "PATIENT", resourceId: c.userId, result: "ALLOWED" });
    return json(200, { answer: withNotice(t === "CRISIS" ? CRISIS_REPLY : EMERGENCY_REPLY), urgent: true });
  }

  if (!(await underLimit(c.userId))) {
    throw new HttpError(429, "You've asked a lot of questions this hour. Try again later, or tap See a doctor now to talk with a physician.");
  }

  let answer: string;
  try {
    const out = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
        inferenceConfig: { maxTokens: ASSISTANT.maxAnswerTokens, temperature: 0.3 },
      }),
    );
    answer = (out.output?.message?.content ?? []).map((b) => ("text" in b ? (b.text ?? "") : "")).join("").trim();
  } catch (err) {
    console.error("assistant_error", (err as Error).name); // never log the question itself
    throw new HttpError(503, "The assistant isn't available right now. Try again in a minute, or tap See a doctor now.");
  }
  if (!answer) answer = "Sorry, I couldn't answer that. Try asking another way, or tap See a doctor now.";

  await audit({ actorId: c.userId, actorRole: "PATIENT", action: "AI_ASSISTANT_USED", resourceType: "PATIENT", resourceId: c.userId, result: "ALLOWED" });
  return json(200, { answer: withNotice(answer), urgent: false });
});
