import Stripe from "stripe";
import type { Quote } from "../domain/fees.js";

let client: Stripe | undefined;
function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured");
  client ??= new Stripe(key);
  return client;
}

/** Physician payout account (Stripe Express). Stripe handles identity + bank verification and 1099s. */
export async function createPhysicianAccount(email: string): Promise<string> {
  const acct = await stripe().accounts.create({
    type: "express",
    country: "US",
    email,
    business_type: "individual",
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { mcc: "8011", product_description: "Telehealth visits through iHealthé" },
  });
  return acct.id;
}

export async function onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url;
}

/**
 * One charge to the patient. The visit price goes to the physician's account,
 * iHealthé keeps only the flat booking fee. Authorized now, captured when the visit completes.
 * Metadata holds opaque ids only. No PHI goes to Stripe.
 */
export async function authorizeVisit(params: {
  quote: Quote;
  physicianAccountId: string;
  requestId: string;
  customerId?: string;
}): Promise<{ paymentIntentId: string; clientSecret: string }> {
  const pi = await stripe().paymentIntents.create(
    {
      amount: params.quote.totalCents,
      currency: "usd",
      capture_method: "manual",
      application_fee_amount: params.quote.platformFeeCents,
      transfer_data: { destination: params.physicianAccountId },
      on_behalf_of: params.physicianAccountId,
      customer: params.customerId,
      description: "iHealthé visit",
      metadata: { request_id: params.requestId },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: `authorize_${params.requestId}` },
  );
  if (!pi.client_secret) throw new Error("Stripe returned no client secret");
  return { paymentIntentId: pi.id, clientSecret: pi.client_secret };
}

/** Verifies a Stripe webhook signature. Throws if the payload wasn't sent by Stripe. */
export function verifyWebhook(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Stripe webhook secret not configured");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

export async function captureVisit(paymentIntentId: string): Promise<void> {
  await stripe().paymentIntents.capture(paymentIntentId, undefined, {
    idempotencyKey: `capture_${paymentIntentId}`,
  });
}

export async function releaseVisit(paymentIntentId: string): Promise<void> {
  await stripe().paymentIntents.cancel(paymentIntentId);
}
