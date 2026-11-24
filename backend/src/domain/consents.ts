/**
 * What a patient must agree to before their first visit. The app shows this exact text,
 * and we store which version they agreed to and when. Changing the text means bumping the
 * version, and every patient is asked again before their next visit.
 * DRAFT WORDING: for attorney review before real patients.
 */
import type { PatientProfile } from "./types.js";

export type ConsentKind = "telehealth" | "privacyNotice";

export const CONSENTS: Record<ConsentKind, { version: string; title: string; text: string }> = {
  telehealth: {
    version: "2026-11-23",
    title: "Consent to care by video",
    text: [
      "iHealthé visits happen by secure video only. iHealthé has no clinics and doesn't offer in-person visits.",
      "Your physician will see and hear you through your device's camera and microphone. Visits are not recorded.",
      "Video care has limits. Your physician can't examine you in person, run lab tests or take X-rays during the visit.",
      "If your physician thinks you need to be seen in person, they'll tell you to visit your own doctor, an urgent care or an emergency room. You're always free to get in-person care elsewhere instead.",
      "iHealthé is not for emergencies. If you think you're having one, call 911.",
      "By tapping I agree, you consent to receive care from iHealthé physicians by video. You can withdraw this consent any time by not booking further visits.",
    ].join("\n\n"),
  },
  privacyNotice: {
    version: "2026-11-23",
    title: "Notice of Privacy Practices",
    text: [
      "This notice explains how your health information may be used and shared, and how you can get access to it.",
      "Your physician uses your information to treat you, to get paid for your visit, and to run their practice. iHealthé handles it for them as their business associate under HIPAA.",
      "We don't sell your information or use it for advertising. We only share it as the law allows or requires, such as with your physician or when required by law.",
      "You have the right to see and get a copy of your records, ask us to correct them, ask how they've been shared, ask us to limit how they're used, and get this notice on paper.",
      "Read the full notice any time at ihealthe.net/privacy-notice.html. Questions or complaints: privacy@ihealthe.net. You can also complain to the U.S. Department of Health and Human Services. We will never retaliate against you for complaining.",
    ].join("\n\n"),
  },
};

/** Consents the patient hasn't agreed to yet, or agreed to an older version of. */
export function missingConsents(p: Pick<PatientProfile, "consents"> | undefined): ConsentKind[] {
  return (Object.keys(CONSENTS) as ConsentKind[]).filter((k) => p?.consents?.[k]?.version !== CONSENTS[k].version);
}
