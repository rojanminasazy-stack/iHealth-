import React from "react";
import { StripeProvider } from "@stripe/stripe-react-native";

/** Phones: Stripe's in-app payment sheet (cards, Apple Pay, Google Pay). */
export function PaymentsProvider({ children }: { children: React.ReactElement | React.ReactElement[] }) {
  return (
    <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""} merchantIdentifier="merchant.net.ihealthe" urlScheme="ihealthe">
      {children}
    </StripeProvider>
  );
}
