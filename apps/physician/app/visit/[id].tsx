import React, { useCallback, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, ErrorText, Field, Heading, Notice, Screen, Small, VideoVisit } from "@ihealthe/shared";
import { api } from "../../lib/session";

/**
 * Physician video visit. Leaving the call doesn't end the visit (so you can rejoin after a dropped call).
 * "Finish visit" asks for a short summary for the patient, then charges the patient's card and sends the receipt.
 */
export default function PhysicianVisit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inCall, setInCall] = useState(true);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = useCallback(() => api.physician.join(id), [id]);

  if (inCall)
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <VideoVisit join={join} onLeave={() => setInCall(false)} />
      </>
    );

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.physician.complete(id, summary.trim());
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Finish visit" }} />
      <Heading>Wrap up</Heading>
      <Field
        label="Summary for the patient"
        placeholder="What we discussed, your plan, and when to seek more care."
        value={summary}
        onChangeText={setSummary}
        multiline
        maxLength={4000}
      />
      <Small>The patient sees this in their app. Keep your full clinical note in your own records system.</Small>
      <Notice>Finishing charges the patient's card. You receive your full visit price through Stripe.</Notice>
      <ErrorText>{error}</ErrorText>
      <Button title="Finish visit" loading={busy} disabled={summary.trim().length < 10} onPress={finish} />
      <Button title="Rejoin video" variant="ghost" onPress={() => setInCall(true)} />
    </Screen>
  );
}
