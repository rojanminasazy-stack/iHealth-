import React, { useCallback } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { VideoVisit } from "@ihealthe/shared";
import { api } from "../../lib/session";

export default function PatientVisit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const join = useCallback(() => api.patient.join(id), [id]);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <VideoVisit join={join} onLeave={() => router.back()} />
    </>
  );
}
