import type { ExpoConfig } from "expo/config";

/**
 * Values come from EXPO_PUBLIC_* env vars (see .env.example). After `cdk deploy`,
 * copy the stack outputs into apps/patient/.env.
 */
const config: ExpoConfig = {
  name: "iHealthé",
  slug: "ihealthe",
  scheme: "ihealthe",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "net.ihealthe.patient",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: "iHealthé uses your camera for video visits with your physician.",
      NSMicrophoneUsageDescription: "iHealthé uses your microphone for video visits with your physician.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "net.ihealthe.patient",
    adaptiveIcon: {
      backgroundColor: "#1B2D52",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["CAMERA", "RECORD_AUDIO"],
    // Keeps app data (including sign-in tokens) out of Android cloud backups.
    allowBackup: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", backgroundColor: "#1B2D52", imageWidth: 180 }],
    ["@stripe/stripe-react-native", { merchantIdentifier: "merchant.net.ihealthe", enableGooglePay: true }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
