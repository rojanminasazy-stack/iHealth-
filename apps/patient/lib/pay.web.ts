import type { CreatedRequest } from "@ihealthe/shared";

/** Website: go to Stripe's hosted checkout; Stripe sends the patient back to their request page. */
export function usePay() {
  return async (created: CreatedRequest): Promise<"held" | "cancelled" | "redirected"> => {
    if (!created.checkoutUrl || !created.checkoutUrl.startsWith("https://checkout.stripe.com/")) throw new Error("Payment couldn't start. Try again.");
    window.location.assign(created.checkoutUrl);
    return "redirected";
  };
}
export const CLIENT = "web" as const;
