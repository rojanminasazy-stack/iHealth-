import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import Stripe from "stripe";
import type { Quote } from "../domain/fees.js";


/**
 * Stripe keys live in AWS Secrets Manager (never in code or Lambda settings) and are read once per container.
 * Secret format: {"secretKey":"sk_...","webhookSecret":"whsec_..."}
 */
let keys: Promise<{ secretKey: string; webhookSecret: string }> | undefined;
function stripeKeys() {
  keys ??= (async () => {
    const arn = process.env.STRIPE_SECRET_ARN;
    if (!arn) throw new Error("Stripe is not configured");
    const r = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }));
    const v = JSON.parse(r.SecretString ?? "{}") as { secretKey?: string; webhookSecret?: string };
    if (!v.secretKey?.startsWith("sk_") && !v.secretKey?.startsWith("rk_")) throw new Error("Stripe secret key missing");
    return { secretKey: v.secretKey!, webhookSecret: v.webhookSecret ?? "" };
  })().catch((e) => {
    keys = undefined; // retry on next call (e.g. right after you add the keys)
    throw e;
  });
  return keys;
}

let client: Stripe | undefined;
async function stripeClient(): Promise<Stripe> {
  client ??= new Stripe((await stripeKeys()).secretKey);
  return client;
}

/** Physician payout account (Stripe Express). Stripe handles identity + bank verification and 1099s. */
export async function createPhysicianAccount(email: string): Promise<string> {
  const acct = await (await stripeClient()).accounts.create({
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
  const link = await (await stripeClient()).accountLinks.create({
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
  const pi = await (await stripeClient()).paymentIntents.create(
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
export async function verifyWebhook(rawBody: string, signature: string): Promise<Stripe.Event> {
  const { webhookSecret } = await stripeKeys();
  if (!webhookSecret) throw new Error("Stripe webhook secret not configured");
  return (await stripeClient()).webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export async function captureVisit(paymentIntentId: string): Promise<void> {
  await (await stripeClient()).paymentIntents.capture(paymentIntentId, undefined, {
    idempotencyKey: `capture_${paymentIntentId}`,
  });
}

export async function releaseVisit(paymentIntentId: string): Promise<void> {
  await (await stripeClient()).paymentIntents.cancel(paymentIntentId);
}

/**
 * Physician subscription (Stripe Billing), separate from their payout account.
 * Founding physicians get a free trial, then the founding price. The card is collected up front.
 */
export async function subscriptionCheckout(params: {
  providerId: string;
  email?: string;
  customerId?: string;
  priceCents: number;
  trialDays: number;
  planLabel: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; customerId: string }> {
  const s = await stripeClient();
  const customerId =
    params.customerId ??
    (
      await s.customers.create(
        { email: params.email, metadata: { provider_id: params.providerId } },
        { idempotencyKey: `customer_${params.providerId}` },
      )
    ).id;
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: params.priceCents,
          recurring: { interval: "month" },
          product_data: { name: `iHealthé Pro — ${params.planLabel}` },
        },
      },
    ],
    subscription_data: {
      trial_period_days: params.trialDays > 0 ? params.trialDays : undefined,
      metadata: { provider_id: params.providerId },
    },
    payment_method_collection: "always",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return { url: session.url, customerId };
}

/** Stripe-hosted page where a physician updates their card or cancels. */
export async function billingPortal(customerId: string, returnUrl: string): Promise<string> {
  const s = await (await stripeClient()).billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return s.url;
}
