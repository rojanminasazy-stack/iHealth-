import React from "react";
import { router } from "expo-router";
import { Body, Button, Card, Label, Notice, Screen, Small, Title } from "@ihealthe/shared";

export default function Home() {
  return (
    <Screen>
      <Label>Welcome</Label>
      <Title>What can we help you with?</Title>
      <Button big title="See a Physician Now" onPress={() => router.push("/intake")} />
      <Card>
        <Body>How it works</Body>
        <Small>1. Tell us what's going on and where you are right now.</Small>
        <Small>2. Pick a physician licensed in your state. You'll see their price before you book.</Small>
        <Small>3. Your card is held, not charged, until your visit is done.</Small>
      </Card>
      <Notice>If you think you're having a medical emergency, call 911. iHealthé is not for emergencies.</Notice>
      <Button title="Account" variant="ghost" onPress={() => router.push("/account")} />
    </Screen>
  );
}
