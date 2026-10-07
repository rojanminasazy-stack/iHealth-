import React, { useEffect, useState } from "react";
import { ActivityIndicator, PermissionsAndroid, Platform, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { JoinInfo } from "./api";
import { color, space } from "./theme";
import { Button, ErrorText } from "./ui";

/** Public visit page on ihealthe.net. It runs the Chime SDK; join details are injected, never put in the URL. */
export const VISIT_PAGE_URL = process.env.EXPO_PUBLIC_VISIT_URL ?? "https://ihealthe.net/visit.html";

async function askAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]);
  return Object.values(r).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

/**
 * Full-screen video visit. `join` fetches fresh meeting + attendee from the API each time,
 * so leaving and rejoining works. `onLeave` fires when the person taps Leave or the visit ends.
 */
export function VideoVisit({ join, onLeave }: { join: () => Promise<JoinInfo>; onLeave: (reason: "left" | "ended") => void }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    setInfo(null);
    (async () => {
      if (!(await askAndroidPermissions())) throw new Error("iHealthé needs camera and microphone access for video visits. Turn them on in Settings.");
      const j = await join();
      if (live) setInfo(j);
    })().catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [join, attempt]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = e.nativeEvent.data;
    if (m === "left") onLeave("left");
    else if (m === "ended") onLeave("ended");
    else if (m.startsWith("error:")) setError(m === "error:connection" ? "Connection lost." : m.slice(6));
  };

  if (error)
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: "center", backgroundColor: color.bg }}>
        <ErrorText>{error}</ErrorText>
        <Button title="Try again" onPress={() => setAttempt((a) => a + 1)} />
        <Button title="Go back" variant="ghost" onPress={() => onLeave("left")} />
      </View>
    );

  if (!info)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0B1424" }}>
        <ActivityIndicator color={color.white} />
      </View>
    );

  return (
    <WebView
      key={attempt}
      source={{ uri: VISIT_PAGE_URL }}
      originWhitelist={["https://*"]}
      injectedJavaScriptBeforeContentLoaded={`window.__IHEALTHE_JOIN__ = ${JSON.stringify(info)}; true;`}
      onMessage={onMessage}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      javaScriptEnabled
      incognito
      cacheEnabled={false}
      allowsBackForwardNavigationGestures={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(r) => r.url.startsWith(VISIT_PAGE_URL.replace(/\/visit\.html$/, ""))}
      style={{ flex: 1, backgroundColor: "#0B1424" }}
    />
  );
}
