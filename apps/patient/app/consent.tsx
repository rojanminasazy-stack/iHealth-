import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Switch } from "react-native";
import { router } from "expo-router";
import { Body, Button, Card, color, ErrorText, Heading, Row, Screen, Small, type ConsentKind } from "@ihealthe/shared";
import { api } from "../lib/session";

type Texts = Record<ConsentKind, { version: string; title: string; text: string }>;

/**
 * Shown once before the first visit (and again if the wording changes).
 * The patient reads the exact text the server stores a version of, then agrees to each part.
 */
export default function Consent() {
  const [texts, setTexts] = useState<Texts | null>(null);
  const [agree, setAgree] = useState<Record<ConsentKind, boolean>>({ telehealth: false, privacyNotice: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.patient.consentText().then((r) => setTexts(r.consents)).catch((e: Error) => setError(e.message));
  }, []);

  const submit = async () => {
    if (!texts) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.patient.acceptConsents(
        (Object.keys(texts) as ConsentKind[]).map((kind) => ({ kind, version: texts[kind].version })),
      );
      if (r.consentsNeeded.length === 0) router.replace("/intake");
      else setError("Something changed. Please review again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!texts) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={color.navy} />}</Screen>;

  return (
    <Screen>
      <Body>Please read these two short notices before your first visit.</Body>
      {(Object.keys(texts) as ConsentKind[]).map((k) => (
        <Card key={k}>
          <Heading>{texts[k].title}</Heading>
          {texts[k].text.split("\n\n").map((p, i) => (
            <Small key={i}>{p}</Small>
          ))}
          {k === "privacyNotice" ? (
            <Button title="Read the full notice" variant="ghost" onPress={() => Linking.openURL("https://ihealthe.net/privacy-notice.html")} />
          ) : null}
          <Row style={{ flexWrap: "nowrap" }}>
            <Switch
              value={agree[k]}
              onValueChange={(on) => setAgree((a) => ({ ...a, [k]: on }))}
              accessibilityLabel={k === "telehealth" ? "I agree to receive care by video" : "I have read the Notice of Privacy Practices"}
            />
            <Small style={{ flex: 1, fontWeight: "700" }}>
              {k === "telehealth" ? "I agree to receive care by video" : "I have read the Notice of Privacy Practices"}
            </Small>
          </Row>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button big title="Continue" loading={busy} disabled={!agree.telehealth || !agree.privacyNotice} onPress={submit} />
    </Screen>
  );
}
