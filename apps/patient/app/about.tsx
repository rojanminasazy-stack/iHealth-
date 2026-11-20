import React, { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Chips,
  color,
  ErrorText,
  Field,
  Label,
  LANGUAGES,
  Notice,
  Screen,
  Small,
  STATES,
  Title,
  type PatientProfileInput,
} from "@ihealthe/shared";
import { api } from "../lib/session";

type StateCode = (typeof STATES)[number]["code"];

/** Turns MM/DD/YYYY (what people type) into YYYY-MM-DD (what the server stores). */
function toIsoDate(mdY: string): string {
  const m = mdY.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return mdY.trim();
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}
function fromIsoDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/**
 * "About you": asked once after sign-up, editable any time. Your physician reads it before your visit.
 * Health answers go only to the iHealthé server (encrypted) and to the physician you're matched with.
 */
export default function About() {
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState<StateCode | undefined>();
  const [zip, setZip] = useState("");
  const [residence, setResidence] = useState<StateCode | undefined>();
  const [history, setHistory] = useState("");
  const [meds, setMeds] = useState("");
  const [chronic, setChronic] = useState("");
  const [allergies, setAllergies] = useState("");
  const [language, setLanguage] = useState<string>("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.patient
      .profile()
      .then(({ profile: p }) => {
        if (!p) return;
        setFullName(p.fullName);
        setDob(fromIsoDate(p.dateOfBirth));
        setPhone(p.phone);
        setLine1(p.address.line1);
        setLine2(p.address.line2 ?? "");
        setCity(p.address.city);
        setAddrState(p.address.state as StateCode);
        setZip(p.address.zip);
        setResidence(p.stateOfResidence as StateCode);
        setHistory(p.medicalHistory);
        setMeds(p.medications);
        setChronic(p.chronicConditions);
        setAllergies(p.allergies);
        setLanguage(p.preferredLanguage ?? "en");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setError(null);
    if (!addrState) return setError("Choose the state for your address.");
    if (!residence) return setError("Choose your state of residence.");
    const p: PatientProfileInput = {
      fullName,
      dateOfBirth: toIsoDate(dob),
      phone,
      address: { line1, line2: line2 || undefined, city, state: addrState, zip },
      stateOfResidence: residence,
      medicalHistory: history,
      medications: meds,
      chronicConditions: chronic,
      allergies,
      preferredLanguage: language,
    };
    setBusy(true);
    try {
      await api.patient.saveProfile(p);
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <Screen>
        <ActivityIndicator color={color.navy} />
      </Screen>
    );

  return (
    <Screen>
      <Title>About you</Title>
      <Small>Your physician reads this before your visit, so you can spend your 20 minutes on what matters. You only fill it in once.</Small>

      <Label>Your details</Label>
      <Field label="Full legal name" value={fullName} onChangeText={setFullName} autoComplete="name" />
      <Field label="Date of birth (MM/DD/YYYY)" value={dob} onChangeText={setDob} keyboardType="numbers-and-punctuation" placeholder="04/25/1990" maxLength={10} autoComplete="birthdate-full" />
      <Field label="Mobile phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="(661) 555-0123" />

      <Label>Home address</Label>
      <Field label="Street address" value={line1} onChangeText={setLine1} autoComplete="street-address" />
      <Field label="Apartment or unit (optional)" value={line2} onChangeText={setLine2} />
      <Field label="City" value={city} onChangeText={setCity} autoComplete="postal-address-locality" />
      <Small>State</Small>
      <Chips options={STATES} value={addrState} onChange={setAddrState} />
      <Field label="ZIP code" value={zip} onChangeText={setZip} keyboardType="number-pad" maxLength={10} autoComplete="postal-code" />

      <Label>State of residence</Label>
      <Chips options={STATES} value={residence} onChange={setResidence} />

      <Label>Preferred language for visits</Label>
      <Chips options={LANGUAGES} value={language as (typeof LANGUAGES)[number]["code"]} onChange={setLanguage} />
      <Small>We'll offer to match you with a doctor who speaks it. You can change this before each visit.</Small>

      <Label>Your health</Label>
      <Field label="Health history" placeholder="Past illnesses, surgeries, hospital stays. Write None if none." value={history} onChangeText={setHistory} multiline maxLength={2000} />
      <Field label="Medications you take now" placeholder="Name and dose, e.g. Lisinopril 10 mg daily. Write None if none." value={meds} onChangeText={setMeds} multiline maxLength={2000} />
      <Field label="Chronic conditions" placeholder="e.g. diabetes, asthma, high blood pressure. Write None if none." value={chronic} onChangeText={setChronic} multiline maxLength={2000} />
      <Field label="Allergies" placeholder="Medicines, foods, latex. Write None if none." value={allergies} onChangeText={setAllergies} multiline maxLength={1000} />

      <Notice>Your answers are encrypted and shared only with the physician you're matched with.</Notice>
      <ErrorText>{error}</ErrorText>
      <Button title="Save" loading={busy} disabled={!fullName || dob.length < 8 || !phone || !line1 || !city || !zip} onPress={save} />
    </Screen>
  );
}
