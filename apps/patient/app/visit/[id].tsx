import React, { useCallback, useEffect } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { VideoVisit } from "@ihealthe/shared";
import { api } from "../../lib/session";

export default function PatientVisit() {
  const { id, after } = useLocalSearchParams<{ id: string; after?: string }>();
  const join = useCallback(() => api.patient.join(id), [id]);
  // Website: back from the video page, so show the visit status instead of rejoining.
  useEffect(() => {
    if (after === "1") router.replace({ pathname: "/request/[id]", params: { id } });
  }, [after, id]);
  if (after === "1") return null;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <VideoVisit join={join} onLeave={() => router.back()} />
    </>
  );
}
