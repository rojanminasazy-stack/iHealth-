import React, { useState } from "react";
import * as Updates from "expo-updates";
import { Body, Button, Card, ErrorText, Field, Heading, Notice, Screen, Small } from "@ihealthe/shared";
import { api, auth } from "../lib/session";

export default function Account() {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    await Updates.reloadAsync().catch(() => {
      // On the website there's no native reload.
      if (typeof window !== "undefined") window.location.reload();
    });
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patient.deleteAccount();
      await auth.signOut().catch(() => {});
      await restart();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Small>Signing out ends your session on every device.</Small>
      <Button
        title="Sign out everywhere"
        variant="ghost"
        loading={busy && !confirming}
        onPress={async () => {
          setBusy(true);
          await auth.signOut();
          await restart();
          setBusy(false);
        }}
      />

      <Card>
        <Heading>Delete my account</Heading>
        <Small>
          This removes your sign-in and your About you details, and you won't be able to book visits with this account. Records of past
          visits are kept for the time the law requires, then deleted. You can ask for a copy of them at privacy@ihealthe.net.
        </Small>
        {!confirming ? (
          <Button title="Delete my account" variant="danger" onPress={() => setConfirming(true)} />
        ) : (
          <>
            <Body>This can't be undone. Type DELETE to confirm.</Body>
            <Field label="Type DELETE" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
            <Button title="Permanently delete my account" variant="danger" loading={busy} disabled={typed.trim() !== "DELETE"} onPress={deleteAccount} />
            <Button title="Keep my account" variant="ghost" onPress={() => (setConfirming(false), setTyped(""))} />
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>

      <Notice>Questions about your privacy or records? Email privacy@ihealthe.net.</Notice>
    </Screen>
  );
}
