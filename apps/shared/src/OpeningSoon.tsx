import React from "react";
import { Linking } from "react-native";
import { Body, Button, Notice, Screen, Title } from "./ui";

/** Shown until the secure backend is switched on, instead of a sign-up that can't work yet. */
export function OpeningSoon({ appName, waitlistUrl }: { appName: string; waitlistUrl: string }) {
  return (
    <Screen>
      <Title>{appName}</Title>
      <Body>We're opening very soon. Accounts, visits and payments switch on the day we launch.</Body>
      <Notice>Get on the early-access list and we'll email you the moment it's ready.</Notice>
      <Button title="Get early access" onPress={() => void Linking.openURL(waitlistUrl)} />
    </Screen>
  );
}

/** True once the app has been pointed at the live iHealthé backend. */
export const backendConfigured = () => !!process.env.EXPO_PUBLIC_API_URL && process.env.EXPO_PUBLIC_API_URL.startsWith("https://");
