import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";

/**
 * Every message the platform can send. Texts are fixed and contain NO health information:
 * no symptoms, conditions, specialties or physician names. Details live behind login in the app.
 */
export const TEMPLATES = {
  PATIENT_WELCOME: {
    subject: "Welcome to iHealthé",
    text: "Your iHealthé account is ready. Open the app any time you need a physician.",
  },
  REQUEST_RECEIVED: {
    subject: "We got your iHealthé request",
    text: "Your iHealthé request is in. We'll let you know as soon as a physician accepts.",
  },
  VISIT_CONFIRMED: {
    subject: "Your iHealthé visit is confirmed",
    text: "Your iHealthé visit is confirmed. Open the app to join when you're ready.",
  },
  VISIT_RECEIPT: {
    subject: "Your iHealthé receipt",
    text: "Thanks for using iHealthé. Your receipt and visit summary are in the app.",
  },
  PROVIDER_APPLICATION_RECEIVED: {
    subject: "We received your iHealthé application",
    text: "Thanks for applying to iHealthé. We're verifying your license and will email you when review is complete.",
  },
  PROVIDER_APPROVED: {
    subject: "You're approved on iHealthé",
    text: "You're approved on iHealthé. Open iHealthé Pro to sign your agreement, set up payouts, and go online.",
  },
  PROVIDER_NOT_APPROVED: {
    subject: "Update on your iHealthé application",
    text: "We weren't able to approve your iHealthé application. Reply to this email if you have questions.",
  },
  PROVIDER_NEW_REQUEST: {
    subject: "New iHealthé patient request",
    text: "You have a new iHealthé patient request. Open iHealthé Pro to review it.",
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

const ses = new SESv2Client({});
const sms = new PinpointSMSVoiceV2Client({});

export interface Recipient {
  email?: string;
  /** E.164, e.g. +16615550123 */
  phone?: string;
}

/** Sends the same short message by email and text. Failures are logged without PHI and never block the main action. */
export async function notify(to: Recipient, template: TemplateName): Promise<void> {
  const t = TEMPLATES[template];
  const from = process.env.EMAIL_FROM;
  const tasks: Promise<unknown>[] = [];
  if (to.email && from) {
    tasks.push(
      ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to.email] },
          Content: { Simple: { Subject: { Data: t.subject }, Body: { Text: { Data: t.text } } } },
        }),
      ),
    );
  }
  const origin = process.env.SMS_ORIGINATION;
  if (to.phone && origin) {
    tasks.push(
      sms.send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: to.phone,
          OriginationIdentity: origin,
          MessageBody: `${t.text} Reply STOP to opt out.`,
          MessageType: "TRANSACTIONAL",
        }),
      ),
    );
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") console.warn(JSON.stringify({ msg: "notify_failed", template }));
  }
}
