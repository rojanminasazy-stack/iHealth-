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
 * Uber-style payments: the patient's card is held when they request a visit, before we know which
 * physician will accept. We use Stripe "separate charges and transfers": the hold sits with iHealthé,
 * and when the visit ends we capture it and transfer the full visit price to the physician who saw them.
 * Metadata holds opaque ids only. No PHI goes to Stripe.
 */
export async function authorizeVisit(params: {
  quote: Quote;
  requestId: string;
  customerId?: string;
}): Promise<{ paymentIntentId: string; clientSecret: string }> {
  const pi = await (await stripeClient()).paymentIntents.create(
    {
      amount: params.quote.totalCents,
      currency: "usd",
      capture_method: "manual",
      transfer_group: params.requestId,
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

/** Web version: a Stripe-hosted checkout page that places the same hold. */
export async function checkoutVisit(params: { quote: Quote; requestId: string; email?: string; returnUrl: string }): Promise<string> {
  const session = await (await stripeClient()).checkout.sessions.create(
    {
      mode: "payment",
      customer_email: params.email,
      line_items: [
        { quantity: 1, price_data: { currency: "usd", unit_amount: params.quote.totalCents, product_data: { name: "iHealthé video visit (20 minutes)" } } },
      ],
      payment_intent_data: {
        capture_method: "manual",
        transfer_group: params.requestId,
        description: "iHealthé visit",
        metadata: { request_id: params.requestId },
      },
      metadata: { request_id: params.requestId },
      success_url: `${params.returnUrl}?paid=1`,
      cancel_url: `${params.returnUrl}?paid=0`,
    },
    { idempotencyKey: `checkout_${params.requestId}` },
  );
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}

/** Charge the held card and pay the physician who did the visit. */
export async function captureVisit(params: { paymentIntentId: string; physicianAccountId: string; physicianReceivesCents: number; requestId: string }): Promise<void> {
  const stripe = await stripeClient();
  const pi = await stripe.paymentIntents.capture(params.paymentIntentId, undefined, { idempotencyKey: `capture_${params.paymentIntentId}` });
  const charge = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
  await stripe.transfers.create(
    {
      amount: params.physicianReceivesCents,
      currency: "usd",
      destination: params.physicianAccountId,
      transfer_group: params.requestId,
      source_transaction: charge,
      metadata: { request_id: params.requestId },
    },
    { idempotencyKey: `transfer_${params.requestId}` },
  );
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

/** Verifies a Stripe webhook signature. Throws if the payload wasn't sent by Stripe. */
export async function verifyWebhook(rawBody: string, signature: string): Promise<Stripe.Event> {
  const { webhookSecret } = await stripeKeys();
  if (!webhookSecret) throw new Error("Stripe webhook secret not configured");
  return (await stripeClient()).webhooks.constructEvent(rawBody, signature, webhookSecret);
}
