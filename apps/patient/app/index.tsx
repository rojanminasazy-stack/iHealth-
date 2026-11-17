import React, { useCallback, useState } from "react";
import { ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Body, Button, Card, color, ErrorText, Label, Notice, Screen, Small, Title } from "@ihealthe/shared";
import { api } from "../lib/session";

export default function Home() {
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New patients answer "About you" once before their first visit.
  useFocusEffect(
    useCallback(() => {
      api.patient
        .profile()
        .then(({ profile }) => {
          setHasProfile(!!profile);
          if (!profile) router.push("/about");
        })
        .catch((e: Error) => setError(e.message));
    }, []),
  );

  return (
    <Screen>
      <Label>Welcome</Label>
      <Title>What can we help you with?</Title>
      {hasProfile === null && !error ? <ActivityIndicator color={color.navy} /> : null}
      <ErrorText>{error}</ErrorText>
      <Button big title="See a Physician Now" disabled={!hasProfile} onPress={() => router.push("/intake")} />
      <Card>
        <Body>How it works</Body>
        <Small>1. Tell us why you're visiting and where you are right now.</Small>
        <Small>2. Choose a physician licensed in your state.</Small>
        <Small>3. Meet face to face in a private 20-minute video visit.</Small>
      </Card>
      <Button title="About you (health details)" variant="ghost" onPress={() => router.push("/about")} />
      <Notice>If you think you're having a medical emergency, call 911. iHealthé is not for emergencies.</Notice>
      <Button title="Account" variant="ghost" onPress={() => router.push("/account")} />
    </Screen>
  );
}
