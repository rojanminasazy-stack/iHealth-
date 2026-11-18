import React from "react";

/** Website: payments happen on Stripe's hosted checkout page, so nothing to load here. */
export function PaymentsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
