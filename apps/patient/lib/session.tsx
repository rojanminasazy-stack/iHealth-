import "react-native-get-random-values"; // crypto for Cognito's sign-in math
import React, { createContext, useContext, useState } from "react";
import { Auth, createApi } from "@ihealthe/shared";

export const auth = new Auth({
  userPoolId: process.env.EXPO_PUBLIC_PATIENT_POOL_ID ?? "",
  clientId: process.env.EXPO_PUBLIC_PATIENT_CLIENT_ID ?? "",
  storagePrefix: "ihealthe.patient",
});

export const api = createApi(process.env.EXPO_PUBLIC_API_URL ?? "", auth);

/** What the patient has told us so far in this booking. Kept in memory only, never on disk. */
export interface Intake {
  chiefComplaint: string;
  symptomDuration: string;
  patientState: string;
  ageGroup: "ADULT" | "CHILD";
  specialty: string;
  language?: string;
}

const Ctx = createContext<{ intake: Intake | null; setIntake: (i: Intake | null) => void }>({
  intake: null,
  setIntake: () => {},
});

export function IntakeProvider({ children }: { children: React.ReactNode }) {
  const [intake, setIntake] = useState<Intake | null>(null);
  return <Ctx.Provider value={{ intake, setIntake }}>{children}</Ctx.Provider>;
}

export const useIntake = () => useContext(Ctx);
