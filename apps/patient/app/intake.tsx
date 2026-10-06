import React, { useState } from "react";
import { router } from "expo-router";
import { Button, Chips, ErrorText, Field, Label, Notice, Screen, SPECIALTIES, STATES } from "@ihealthe/shared";
import { useIntake } from "../lib/session";

const DURATIONS = [
  { code: "Today", name: "Today" },
  { code: "Yesterday", name: "Yesterday" },
  { code: "2–3 days", name: "2–3 days" },
  { code: "4–7 days", name: "4–7 days" },
  { code: "Longer", name: "Longer" },
] as const;

const WHO = [
  { code: "ADULT", name: "Me (18+)" },
  { code: "CHILD", name: "My child" },
] as const;

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fa", name: "Farsi" },
  { code: "zh", name: "Chinese" },
] as const;

export default function Intake() {
  const { intake, setIntake } = useIntake();
  const [chiefComplaint, setComplaint] = useState(intake?.chiefComplaint ?? "");
  const [symptomDuration, setDuration] = useState<string | undefined>(intake?.symptomDuration);
  const [patientState, setState] = useState<string | undefined>(intake?.patientState);
  const [ageGroup, setAge] = useState<"ADULT" | "CHILD">(intake?.ageGroup ?? "ADULT");
  const [specialty, setSpecialty] = useState<string>(intake?.specialty ?? "FAMILY_MEDICINE");
  const [language, setLanguage] = useState<string>(intake?.language ?? "en");
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    if (chiefComplaint.trim().length < 3) return setError("Tell us a little about what's going on.");
    if (!symptomDuration) return setError("Choose when this started.");
    if (!patientState) return setError("Choose where you are right now.");
    setIntake({ chiefComplaint: chiefComplaint.trim(), symptomDuration, patientState, ageGroup, specialty, language });
    router.push("/choose");
  };

  return (
    <Screen>
      <Field
        label="Tell us what you're experiencing"
        placeholder="Sore throat and fever since yesterday"
        value={chiefComplaint}
        onChangeText={setComplaint}
        multiline
        maxLength={500}
      />
      <Label>When did this start?</Label>
      <Chips options={DURATIONS} value={symptomDuration as (typeof DURATIONS)[number]["code"] | undefined} onChange={setDuration} />
      <Label>Where are you physically located right now?</Label>
      <Chips options={STATES} value={patientState as (typeof STATES)[number]["code"] | undefined} onChange={setState} />
      <Notice>Physicians can only see you in states where they're licensed, so this needs to be where you are right now, not your home address.</Notice>
      <Label>Who is the visit for?</Label>
      <Chips options={WHO} value={ageGroup} onChange={setAge} />
      <Label>Type of care</Label>
      <Chips options={SPECIALTIES} value={specialty as (typeof SPECIALTIES)[number]["code"]} onChange={setSpecialty} />
      <Label>Preferred language</Label>
      <Chips options={LANGUAGES} value={language as (typeof LANGUAGES)[number]["code"]} onChange={setLanguage} />
      <ErrorText>{error}</ErrorText>
      <Button title="Find physicians" onPress={next} />
    </Screen>
  );
}
