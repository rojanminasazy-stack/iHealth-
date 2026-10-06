import "react-native-get-random-values";
import { Auth, createApi } from "@ihealthe/shared";

export const auth = new Auth({
  userPoolId: process.env.EXPO_PUBLIC_PHYSICIAN_POOL_ID ?? "",
  clientId: process.env.EXPO_PUBLIC_PHYSICIAN_CLIENT_ID ?? "",
  storagePrefix: "ihealthe.pro",
});

export const api = createApi(process.env.EXPO_PUBLIC_API_URL ?? "", auth);

/** Version of the Business Associate Agreement shown in the app. Bump when the attorney revises it. */
export const BAA_VERSION = "2026-10-draft";
