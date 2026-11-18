import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { JoinInfo } from "./api";
import { space } from "./theme";
import { Button, ErrorText, Small } from "./ui";

/**
 * Website version of the video visit. The join details go into this tab's sessionStorage (never the URL),
 * then the browser opens the secure visit page on the same site, which reads and deletes them.
 */
export function VideoVisit({ join, onLeave }: { join: () => Promise<JoinInfo>; onLeave: (reason: "left" | "ended") => void }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    join()
      .then((info) => {
        sessionStorage.setItem("ihealthe.join", JSON.stringify(info));
        sessionStorage.setItem("ihealthe.return", `${window.location.pathname}?after=1`);
        window.location.assign("/visit.html");
      })
      .catch((e: Error) => setError(e.message));
  }, [join]);
  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: "center" }}>
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          <Button title="Go back" variant="ghost" onPress={() => onLeave("left")} />
        </>
      ) : (
        <Small>Opening your secure video visit…</Small>
      )}
    </View>
  );
}
