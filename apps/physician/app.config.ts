import type { ExpoConfig } from "expo/config";

/** Values come from EXPO_PUBLIC_* env vars (see .env.example). */
const config: ExpoConfig = {
  name: "iHealthé Pro",
  slug: "ihealthe-pro",
  scheme: "ihealthepro",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "net.ihealthe.pro",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: "iHealthé Pro uses your camera for video visits with patients.",
      NSMicrophoneUsageDescription: "iHealthé Pro uses your microphone for video visits with patients.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "net.ihealthe.pro",
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
  ],
  experiments: { typedRoutes: true },
};

export default config;
