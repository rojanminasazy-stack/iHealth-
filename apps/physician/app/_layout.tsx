import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthFlow, backendConfigured, color, OpeningSoon, useWebDeepLink } from "@ihealthe/shared";
import { auth } from "../lib/session";

export default function RootLayout() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  useWebDeepLink(useCallback((path: string) => router.replace(path as never), []));

  useEffect(() => {
    if (!backendConfigured()) return;
    auth.isSignedIn().then((ok) => setState(ok ? "in" : "out"));
  }, []);

  if (!backendConfigured()) return <OpeningSoon appName="iHealthé Pro" waitlistUrl="https://ihealthe.net/apply.html" />;

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
        appName="iHealthé Pro"
        tagline="Go online when you're free. Get matched with patients in your state. Get paid directly."
        mfaNote="Physician accounts always use two-step sign-in. We'll text a code to your mobile number each time you sign in."
        onSignedIn={() => setState("in")}
      />
    );

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color.navy },
          headerTintColor: color.white,
          contentStyle: { backgroundColor: color.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "iHealthé Pro" }} />
        <Stack.Screen name="apply" options={{ title: "Apply" }} />
        <Stack.Screen name="baa" options={{ title: "Business Associate Agreement" }} />
        <Stack.Screen name="visit/[id]" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
      </Stack>
    </>
  );
}
