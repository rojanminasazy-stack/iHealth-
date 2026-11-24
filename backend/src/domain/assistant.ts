/**
 * Rules for the patient AI assistant, kept pure so they can be tested.
 *  - Emergencies are caught by code BEFORE the AI sees the message, and get a fixed reply.
 *  - Every answer ends with the AI notice. Code adds it, so the model can't leave it out.
 *  - Nothing the patient types is stored. Only "used the assistant" goes in the audit log.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const ASSISTANT = {
  maxMessages: 12,
  maxCharsPerMessage: 1_000,
  maxQuestionsPerHour: 30,
  maxAnswerTokens: 600,
} as const;

/** Shown under every answer, AI-written or fixed. California AB 3030: say it's AI and how to reach a human. */
export const AI_NOTICE =
  "This answer came from iHealthé's AI assistant, not a doctor, and it isn't medical advice. If your concern is more serious, ask your iHealthé physician (tap See a doctor now), or call 911 if it's an emergency.";

export const EMERGENCY_REPLY =
  "What you're describing could be an emergency. Please call 911 now or go to the nearest emergency room. Don't wait for an online visit.";

export const CRISIS_REPLY =
  "I'm really sorry you're going through this. You don't have to handle it alone. Please call or text 988 (Suicide & Crisis Lifeline) right now to talk with someone, any time, day or night. If you're in immediate danger, call 911.";

const CRISIS = [
  /\bsuicid/i,
  /\bkill (myself|me)\b/i,
  /\bend (my|it all|my life)\b/i,
  /\bwant(ing)? to die\b/i,
  /\bself[- ]?harm/i,
  /\bhurt(ing)? myself\b/i,
  /\bcut(ting)? myself\b/i,
  /\boverdos/i,
];

const EMERGENCY = [
  /\bchest (pain|pressure|tightness)\b/i,
  /\b(can'?t|cannot|trouble|hard to|difficulty) breath/i,
  /\bshort(ness)? of breath\b/i,
  /\bnot breathing\b/i,
  /\bchoking\b/i,
  /\bstroke\b/i,
  /\b(face|arm|smile) (is )?(droop|numb)/i,
  /\bslurred speech\b/i,
  /\bseizure/i,
  /\b(passed|passing) out\b/i,
  /\bunconscious\b/i,
  /\bwon'?t wake up\b/i,
  /\bheart attack\b/i,
  /\banaphyla/i,
  /\b(throat|tongue|lips?) (is |are )?(swelling|swollen|closing)\b/i,
  /\b(severe|heavy|won'?t stop|uncontrolled) bleeding\b/i,
  /\bbleeding (a lot|heavily|won'?t stop)\b/i,
  /\bcoughing (up )?blood\b/i,
  /\bvomiting blood\b/i,
  /\bpoison/i,
  /\bworst headache\b/i,
  /\bblue lips\b/i,
];

export type Triage = "CRISIS" | "EMERGENCY" | "OK";

export function triage(text: string): Triage {
  if (CRISIS.some((r) => r.test(text))) return "CRISIS";
  if (EMERGENCY.some((r) => r.test(text))) return "EMERGENCY";
  return "OK";
}

/** Keeps only well-formed turns, trims them, and caps how much history goes to the model. */
export function cleanHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-ASSISTANT.maxMessages)) {
    if (!m || typeof m !== "object") continue;
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.replace(AI_NOTICE, "").trim().slice(0, ASSISTANT.maxCharsPerMessage);
    if (text) out.push({ role, content: text });
  }
  // The model needs user/assistant turns to alternate, starting and ending with the patient.
  const merged: ChatMessage[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`.slice(0, ASSISTANT.maxCharsPerMessage * 2);
    else merged.push({ ...m });
  }
  while (merged[0]?.role === "assistant") merged.shift();
  return merged;
}

export function withNotice(answer: string): string {
  return `${answer.trim()}\n\n${AI_NOTICE}`;
}

export const SYSTEM_PROMPT = `You are the iHealthé assistant, an AI inside the iHealthé telehealth app. Patients ask you simple, general health questions.

What you do:
- Give clear, general health information in plain, friendly language. Short answers: usually 2 to 6 sentences, or a few short bullets.
- Explain common conditions, symptoms in general terms, healthy habits, how to prepare for a visit, and when it makes sense to see a doctor.
- Answer questions about iHealthé: patients are usually connected in under 15 minutes for a 20-minute video visit with a physician licensed in their state, for $79. Patients tap "See a doctor now" to be matched. Patients can ask for a doctor who speaks their language.
- Reply in the language the patient writes in.

What you never do:
- Never diagnose the patient or say what they "have". Never say a symptom is definitely nothing to worry about.
- Never recommend a specific prescription drug, never give a dose, and never tell anyone to start, stop or change a medication. For over-the-counter medicine, say only to follow the label and ask a pharmacist or physician.
- Never interpret the patient's own test results, images or lab values.
- Never claim to be a doctor, nurse or human.
- Don't ask for or repeat personal details like full name, date of birth, address or insurance numbers.
- Don't answer questions unrelated to health or iHealthé. Politely say you can only help with health questions.

When to send them on:
- If something sounds like it needs a professional, say so plainly and suggest a visit with an iHealthé physician.
- If anything could be an emergency, tell them to call 911 now.
- If anyone mentions suicide or self-harm, tell them to call or text 988, or 911 if in immediate danger.

Don't add a disclaimer at the end of your answer. The app adds one automatically.`;
