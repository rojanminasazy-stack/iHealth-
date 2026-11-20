import React, { useEffect, useState } from "react";
import { Switch } from "react-native";
import { router } from "expo-router";
import { Button, Chips, ErrorText, Field, Label, LANGUAGES, languageName, Notice, Row, Screen, Small, SPECIALTIES, STATES } from "@ihealthe/shared";
import { api, useIntake } from "../lib/session";

const DURATIONS = [
  { code: "Today", name: "Today" },
  { code: "Yesterday", name: "Yesterday" },
  { code: "2–3 days", name: "2–3 days" },
  { code: "4–7 days", name: "4–7 days" },
  { code: "Longer", name: "Longer" },
] as const;

export default function Intake() {
  const { intake, setIntake } = useIntake();
  const [chiefComplaint, setComplaint] = useState(intake?.chiefComplaint ?? "");
  const [symptomDuration, setDuration] = useState<string | undefined>(intake?.symptomDuration);
  const [patientState, setState] = useState<string | undefined>(intake?.patientState);
  const [specialty, setSpecialty] = useState<string>(intake?.specialty ?? "FAMILY_MEDICINE");
  const [language, setLanguage] = useState<string>(intake?.language ?? "en");
  const [languageMatch, setLanguageMatch] = useState<boolean>(intake?.languageMatch ?? false);

  // Start from the language saved in "About you". Non-English speakers get the match switched on by default.
  useEffect(() => {
    if (intake) return;
    api.patient
      .profile()
      .then(({ profile }) => {
        const saved = profile?.preferredLanguage ?? "en";
        setLanguage(saved);
        setLanguageMatch(saved !== "en");
      })
      .catch(() => {});
  }, [intake]);
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    if (chiefComplaint.trim().length < 3) return setError("Tell us a little about what's going on.");
    if (!symptomDuration) return setError("Choose when this started.");
    if (!patientState) return setError("Choose where you are right now.");
    setIntake({ chiefComplaint: chiefComplaint.trim(), symptomDuration, patientState, ageGroup: "ADULT", specialty, language, languageMatch });
    router.push("/choose");
  };

  return (
    <Screen>
      <Field
        label="Reason for your visit"
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
      <Label>Type of care</Label>
      <Chips options={SPECIALTIES} value={specialty as (typeof SPECIALTIES)[number]["code"]} onChange={setSpecialty} />
      <Label>Preferred language</Label>
      <Chips
        options={LANGUAGES}
        value={language as (typeof LANGUAGES)[number]["code"]}
        onChange={(code) => {
          setLanguage(code);
          setLanguageMatch(code !== "en");
        }}
      />
      <Row style={{ flexWrap: "nowrap" }}>
        <Switch value={languageMatch} onValueChange={setLanguageMatch} accessibilityLabel={`Only match me with a doctor who speaks ${languageName(language)}`} />
        <Small style={{ flex: 1 }}>{`Only match me with a doctor who speaks ${languageName(language)}`}</Small>
      </Row>
      <Small>{languageMatch ? "This can take a little longer if fewer doctors who speak your language are online." : "We'll connect you with any available doctor and show which languages each one speaks."}</Small>
      <ErrorText>{error}</ErrorText>
      <Button title="Find physicians" onPress={next} />
    </Screen>
  );
}
