import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StripeProvider } from "@stripe/stripe-react-native";
import { AuthFlow, color } from "@ihealthe/shared";
import { auth, IntakeProvider } from "../lib/session";

export default function RootLayout() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");

  useEffect(() => {
    auth.isSignedIn().then((ok) => setState(ok ? "in" : "out"));
  }, []);

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
        tagline="See a licensed physician from your phone, usually within minutes."
        onSignedIn={() => setState("in")}
      />
    );

  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
      merchantIdentifier="merchant.net.ihealthe"
      urlScheme="ihealthe"
    >
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
          <Stack.Screen name="intake" options={{ title: "What's going on?" }} />
          <Stack.Screen name="choose" options={{ title: "Choose your physician" }} />
          <Stack.Screen name="request/[id]" options={{ title: "Your visit", headerBackVisible: false }} />
          <Stack.Screen name="visit/[id]" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="account" options={{ title: "Account" }} />
        </Stack>
      </IntakeProvider>
    </StripeProvider>
  );
}
