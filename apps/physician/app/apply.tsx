import React, { useState } from "react";
import { Switch } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Chips,
  ErrorText,
  Field,
  Label,
  Notice,
  Row,
  Screen,
  Small,
  SPECIALTIES,
  STATES,
} from "@ihealthe/shared";
import { api } from "../lib/session";

const CREDENTIALS = [
  { code: "MD", name: "MD" },
  { code: "DO", name: "DO" },
] as const;

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fa", name: "Farsi" },
  { code: "zh", name: "Chinese" },
] as const;

interface LicenseDraft {
  state?: string;
  number: string;
  expiresOn: string;
}

export default function Apply() {
  const [fullName, setFullName] = useState("");
  const [credentials, setCredentials] = useState<string>("MD");
  const [npi, setNpi] = useState("");
  const [specialty, setSpecialty] = useState<string>("FAMILY_MEDICINE");
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [licenses, setLicenses] = useState<LicenseDraft[]>([{ number: "", expiresOn: "" }]);
  const [price, setPrice] = useState("79");
  const [peds, setPeds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLic = (i: number, patch: Partial<LicenseDraft>) =>
    setLicenses((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    setError(null);
    if (licenses.some((l) => !l.state)) return setError("Choose the state for each license.");
    const dollars = Number(price);
    if (!Number.isFinite(dollars)) return setError("Enter your visit price in dollars, like 79.");
    setBusy(true);
    try {
      await api.physician.apply({
        fullName,
        credentials,
        npi: npi.trim(),
        specialty,
        languages,
        licenses: licenses.map((l) => ({ state: l.state!, number: l.number, expiresOn: l.expiresOn.trim() })),
        visitPriceCents: Math.round(dollars * 100),
        acceptsPediatric: peds,
      });
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Small>We check every license with the state medical board before you can see patients. This usually takes 1–3 business days.</Small>
      <Field label="Full legal name" value={fullName} onChangeText={setFullName} placeholder="Dana Park" autoComplete="name" />
      <Label>Credentials</Label>
      <Chips options={CREDENTIALS} value={credentials as "MD" | "DO"} onChange={setCredentials} />
      <Field label="NPI number" value={npi} onChangeText={setNpi} keyboardType="number-pad" maxLength={10} placeholder="10 digits" />
      <Label>Specialty</Label>
      <Chips options={SPECIALTIES} value={specialty as (typeof SPECIALTIES)[number]["code"]} onChange={setSpecialty} />

      {licenses.map((l, i) => (
        <React.Fragment key={i}>
          <Label>{`Medical license ${licenses.length > 1 ? i + 1 : ""}`.trim()}</Label>
          <Chips options={STATES} value={l.state as (typeof STATES)[number]["code"] | undefined} onChange={(s) => setLic(i, { state: s })} />
          <Field label="License number" value={l.number} onChangeText={(t) => setLic(i, { number: t })} autoCapitalize="characters" placeholder="A-123456" />
          <Field label="Expiration date" value={l.expiresOn} onChangeText={(t) => setLic(i, { expiresOn: t })} placeholder="2028-06-30" keyboardType="numbers-and-punctuation" maxLength={10} />
          {licenses.length > 1 ? (
            <Button title="Remove this license" variant="ghost" onPress={() => setLicenses((ls) => ls.filter((_, j) => j !== i))} />
          ) : null}
        </React.Fragment>
      ))}
      {licenses.length < 10 ? (
        <Button title="Add another state license" variant="ghost" onPress={() => setLicenses((ls) => [...ls, { number: "", expiresOn: "" }])} />
      ) : null}

      <Label>Languages you see patients in</Label>
      <Chips
        options={LANGUAGES}
        value={undefined}
        onChange={(code) => setLanguages((ls) => (ls.includes(code) ? ls.filter((x) => x !== code) : [...ls, code]))}
      />
      <Small>Selected: {languages.join(", ") || "none"}</Small>

      <Field label="Your visit price (USD)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <Small>Between $25 and $300. Patients pay you this directly. iHealthé adds a separate booking fee for the patient.</Small>
      <Row style={{ flexWrap: "nowrap" }}>
        <Switch value={peds} onValueChange={setPeds} accessibilityLabel="I see patients under 18" />
        <Small style={{ flex: 1 }}>I see patients under 18</Small>
      </Row>
      <Notice>After you submit, you'll upload your resume or CV. Then our team reviews your application.</Notice>
      <ErrorText>{error}</ErrorText>
      <Button title="Submit application" loading={busy} disabled={!fullName || !npi} onPress={submit} />
    </Screen>
  );
}
