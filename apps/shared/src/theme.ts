/** iHealthé brand: navy, gray, white. One accent for actions; semantic colors for status only. */
export const color = {
  navy: "#1B2D52",
  navySoft: "#2B4679",
  ink: "#14213A",
  muted: "#5D6879",
  line: "#D7DDE6",
  bg: "#F4F6F9",
  surface: "#FFFFFF",
  soft: "#E6ECF5",
  accent: "#2F6FD6",
  good: "#1F8A5B",
  warn: "#B7791F",
  bad: "#B83A3A",
  white: "#FFFFFF",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = {
  title: { fontSize: 28, fontWeight: "700" as const, color: color.navy, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: "700" as const, color: color.ink },
  body: { fontSize: 16, color: color.ink, lineHeight: 22 },
  small: { fontSize: 14, color: color.muted, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: "700" as const, color: color.muted, letterSpacing: 1, textTransform: "uppercase" as const },
};

export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const STATES = [
  { code: "CA", name: "California" },
  { code: "TX", name: "Texas" },
  { code: "NY", name: "New York" },
  { code: "FL", name: "Florida" },
  { code: "AZ", name: "Arizona" },
  { code: "NV", name: "Nevada" },
  { code: "OR", name: "Oregon" },
  { code: "WA", name: "Washington" },
] as const;

export const SPECIALTIES = [
  { code: "FAMILY_MEDICINE", name: "Family Medicine" },
  { code: "INTERNAL_MEDICINE", name: "Internal Medicine" },
  { code: "EMERGENCY_MEDICINE", name: "Urgent Care" },
  { code: "PEDIATRICS", name: "Pediatrics" },
  { code: "PSYCHIATRY", name: "Psychiatry" },
  { code: "DERMATOLOGY", name: "Dermatology" },
] as const;

export const specialtyName = (code: string) => SPECIALTIES.find((s) => s.code === code)?.name ?? code;
