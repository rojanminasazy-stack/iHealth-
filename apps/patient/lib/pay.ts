import { useStripe } from "@stripe/stripe-react-native";
import type { CreatedRequest } from "@ihealthe/shared";

/** Phones: show Stripe's payment sheet to place the card hold. */
export function usePay() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return async (created: CreatedRequest): Promise<"held" | "cancelled" | "redirected"> => {
    if (!created.paymentClientSecret) throw new Error("Payment couldn't start. Try again.");
    const init = await initPaymentSheet({
      merchantDisplayName: "iHealthé",
      paymentIntentClientSecret: created.paymentClientSecret,
      applePay: { merchantCountryCode: "US" },
      googlePay: { merchantCountryCode: "US", testEnv: __DEV__ },
    });
    if (init.error) throw new Error(init.error.message);
    const paid = await presentPaymentSheet();
    if (paid.error) {
      if (paid.error.code === "Canceled") return "cancelled";
      throw new Error(paid.error.message);
    }
    return "held";
  };
}
export const CLIENT = "app" as const;
