import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PaymentsProvider } from "../components/PaymentsProvider";
import { AuthFlow, backendConfigured, color, OpeningSoon, useWebDeepLink } from "@ihealthe/shared";
import { auth, IntakeProvider } from "../lib/session";

export default function RootLayout() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  useWebDeepLink(useCallback((path: string) => router.replace(path as never), []));

  useEffect(() => {
    if (!backendConfigured()) return;
    auth.isSignedIn().then((ok) => setState(ok ? "in" : "out"));
  }, []);

  if (!backendConfigured()) return <OpeningSoon appName="iHealthé" waitlistUrl="https://ihealthe.net/waitlist.html" />;

  if (state === "loading")
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.bg }}>
        <ActivityIndicator color={color.navy} />
      </View>
    );

  if (state === "out")
    return (
      <AuthFlow
        auth={auth}
        appName="iHealthé"
        tagline="See a licensed physician from your phone, usually in under 15 minutes."
        onSignedIn={() => setState("in")}
      />
    );

  return (
    <PaymentsProvider>
      <IntakeProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: color.navy },
            headerTintColor: color.white,
            headerTitleStyle: { fontWeight: "700" },
            contentStyle: { backgroundColor: color.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: "iHealthé" }} />
          <Stack.Screen name="about" options={{ title: "About you" }} />
          <Stack.Screen name="ask" options={{ title: "Ask a health question" }} />
          <Stack.Screen name="consent" options={{ title: "Before your first visit" }} />
          <Stack.Screen name="intake" options={{ title: "What's going on?" }} />
          <Stack.Screen name="choose" options={{ title: "Find a doctor" }} />
          <Stack.Screen name="request/[id]" options={{ title: "Your visit", headerBackVisible: false }} />
          <Stack.Screen name="visit/[id]" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="account" options={{ title: "Account" }} />
        </Stack>
      </IntakeProvider>
    </PaymentsProvider>
  );
}
