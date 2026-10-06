import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { ValidationError } from "../domain/validation.js";
import { TransitionError } from "../domain/stateMachines.js";
import { FeeError } from "../domain/fees.js";
import type { ActorRole } from "../domain/types.js";

export type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
export type Result = APIGatewayProxyResultV2;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
};

export const json = (status: number, body: unknown): Result => ({
  statusCode: status,
  headers: HEADERS,
  body: JSON.stringify(body),
});

export function body(e: Event): Record<string, unknown> {
  if (!e.body) return {};
  try {
    const raw = e.isBase64Encoded ? Buffer.from(e.body, "base64").toString("utf8") : e.body;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "Request body must be a JSON object.");
}

export interface Caller {
  userId: string;
  role: ActorRole;
  groups: string[];
}

/**
 * Identity comes only from the verified Cognito token, never from the request body.
 * Each user pool has its own API route prefix, so the pool also fixes the role.
 */
export function caller(e: Event, role: Exclude<ActorRole, "SYSTEM">): Caller {
  const claims = e.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = claims["sub"];
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Sign in to continue.");
  const rawGroups = claims["cognito:groups"];
  const groups =
    typeof rawGroups === "string"
      ? rawGroups.replace(/^\[|\]$/g, "").split(/[ ,]+/).filter(Boolean)
      : Array.isArray(rawGroups)
        ? rawGroups.map(String)
        : [];
  return { userId: sub, role, groups };
}

export function requireGroup(c: Caller, group: string): void {
  if (!c.groups.includes(group)) throw new HttpError(403, "You don't have permission to do that.");
}

/** Wraps a handler: maps known errors to clean responses and never leaks internals or PHI to logs. */
export function handler(fn: (e: Event) => Promise<Result>) {
  return async (e: Event): Promise<Result> => {
    try {
      return await fn(e);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof ValidationError || err instanceof FeeError) return json(400, { error: err.message });
      if (err instanceof TransitionError) return json(409, { error: err.message });
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
        return json(409, { error: "This was already changed by someone else. Refresh and try again." });
      }
      console.error(JSON.stringify({ msg: "unhandled_error", route: e.routeKey, name: (err as Error).name }));
      return json(500, { error: "Something went wrong on our side. Try again in a moment." });
    }
  };
}
