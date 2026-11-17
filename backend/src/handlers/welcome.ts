import type { PostConfirmationTriggerEvent } from "aws-lambda";
import { notify } from "../lib/notify.js";

/**
 * Cognito post-confirmation trigger on the patient pool: once a patient confirms their
 * email, send the welcome email and welcome text. Never blocks sign-up if sending fails.
 */
export const main = async (e: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> => {
  if (e.triggerSource === "PostConfirmation_ConfirmSignUp") {
    const a = e.request.userAttributes;
    await notify({ email: a["email"], phone: a["phone_number"] }, "PATIENT_WELCOME").catch(() => undefined);
  }
  return e;
};
