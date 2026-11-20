import { STATES, type AgeGroup, type Specialty, type StateCode } from "./types.js";

export class ValidationError extends Error {}

const SPECIALTIES: Specialty[] = [
  "FAMILY_MEDICINE",
  "INTERNAL_MEDICINE",
  "EMERGENCY_MEDICINE",
  "PEDIATRICS",
  "PSYCHIATRY",
  "DERMATOLOGY",
];

export function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string") throw new ValidationError(`${field} is required.`);
  const t = v.trim();
  if (!t) throw new ValidationError(`${field} is required.`);
  if (t.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer.`);
  return t;
}

export function state(v: unknown, field = "State"): StateCode {
  if (typeof v === "string" && (STATES as readonly string[]).includes(v)) return v as StateCode;
  throw new ValidationError(`${field} must be one of: ${STATES.join(", ")}.`);
}

export function specialty(v: unknown): Specialty {
  if (typeof v === "string" && (SPECIALTIES as string[]).includes(v)) return v as Specialty;
  throw new ValidationError("Specialty is not supported.");
}

/** Keep in sync with LANGUAGES in apps/shared/src/theme.ts. */
export const LANGUAGE_CODES = ["en", "es", "zh", "yue", "tl", "vi", "ko", "hy", "fa", "ar", "ru", "hi", "pa", "ja", "fr", "pt", "ase"] as const;

export function language(v: unknown, field = "Language"): string {
  if (typeof v === "string" && (LANGUAGE_CODES as readonly string[]).includes(v)) return v;
  throw new ValidationError(`${field} is not one we support yet.`);
}

export function ageGroup(v: unknown): AgeGroup {
  if (v === "ADULT" || v === "CHILD") return v;
  throw new ValidationError("Age group must be ADULT or CHILD.");
}

/** NPI: 10 digits with a valid Luhn check digit (prefix 80840), per CMS. */
export function npi(v: unknown): string {
  const s = str(v, "NPI", 10);
  if (!/^\d{10}$/.test(s)) throw new ValidationError("NPI must be 10 digits.");
  const digits = ("80840" + s.slice(0, 9)).split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
    let d = digits[i]!;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(s[9])) throw new ValidationError("NPI check digit is invalid.");
  return s;
}

export function licenseNumber(v: unknown): string {
  const s = str(v, "License number", 30).toUpperCase();
  if (!/^[A-Z0-9-]{3,30}$/.test(s)) throw new ValidationError("License number has invalid characters.");
  return s;
}

export function isoDate(v: unknown, field: string): string {
  const s = str(v, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ValidationError(`${field} must be a date like 2027-06-30.`);
  }
  return s;
}

/** Free text that may be empty (e.g. "None"), trimmed and length-capped. */
export function text(v: unknown, field: string, max = 2000): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new ValidationError(`${field} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer.`);
  return t;
}

export function zip(v: unknown): string {
  const s = str(v, "ZIP code", 10);
  if (!/^\d{5}(-\d{4})?$/.test(s)) throw new ValidationError("ZIP code must be 5 digits.");
  return s;
}

/** E.164 US phone, e.g. +16615550123. */
export function phone(v: unknown): string {
  const s = str(v, "Phone number", 20).replace(/[\s()-]/g, "");
  const n = s.startsWith("+") ? s : s.length === 10 ? `+1${s}` : `+${s}`;
  if (!/^\+1\d{10}$/.test(n)) throw new ValidationError("Enter a US mobile number, like (661) 555-0123.");
  return n;
}

/** Age in whole years on a given ISO date. */
export function ageOn(dob: string, today: string): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

/** Date of birth: a real past date, patient 18–120. */
export function dateOfBirth(v: unknown, today: string): string {
  const s = isoDate(v, "Date of birth");
  const age = ageOn(s, today);
  if (s >= today || age > 120) throw new ValidationError("Check your date of birth.");
  if (age < 18) throw new ValidationError("You need to be 18 or older to create an account. Visits for children are coming soon.");
  return s;
}
