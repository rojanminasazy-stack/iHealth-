import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  Body,
  Button,
  Card,
  color,
  ErrorText,
  Heading,
  Label,
  money,
  Notice,
  Pill,
  Row,
  Screen,
  Small,
  specialtyName,
  Title,
  type RequestStatus,
} from "@ihealthe/shared";
import { api, useIntake } from "../../lib/session";

const DONE = ["COMPLETED", "CANCELLED", "EXPIRED", "PROVIDER_CANCELLED"];

export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setIntake } = useIntake();
  const [r, setR] = useState<RequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        const next = await api.patient.request(id);
        setR(next);
        if (DONE.includes(next.status) && timer.current) clearInterval(timer.current);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void tick();
    timer.current = setInterval(tick, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [id]);

  const home = () => {
    setIntake(null);
    router.replace("/");
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.patient.cancel(id);
      setR((x) => (x ? { ...x, status: "CANCELLED" } : x));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!r) return <Screen><ActivityIndicator color={color.navy} /><ErrorText>{error}</ErrorText></Screen>;

  const waiting = r.status === "REQUESTED" || r.status === "OFFERED";
  return (
    <Screen>
      {waiting ? (
        <>
          <Label>{r.status === "REQUESTED" ? "Confirming your payment" : "Request sent"}</Label>
          <Title>{r.physician ? `Waiting for ${r.physician.name.split(",")[0]}` : "Finding your doctor…"}</Title>
          <ActivityIndicator color={color.navy} size="large" />
          <Body>
            {r.physician
              ? "We've let them know. If they can't take you, we'll offer your visit to the next available doctor."
              : "We're offering your visit to verified doctors licensed in your state. Most patients are matched within a few minutes."}
          </Body>
          <Small>You'll get a text and email the moment a doctor accepts. If nobody does within 10 minutes, the card hold is released.</Small>
          <Button title="Cancel request" variant="ghost" loading={busy} onPress={cancel} />
        </>
      ) : null}

      {r.status === "MATCHED" || r.status === "IN_VISIT" ? (
        <>
          <Label>Physician accepted</Label>
          <Title>{r.physician?.name}</Title>
          <Row>
            <Pill tone="good" text="LICENSE VERIFIED" />
            {r.physician ? <Pill text={specialtyName(r.physician.specialty)} /> : null}
          </Row>
          {r.status === "MATCHED" ? (
            <Card>
              <Heading>Your physician is getting ready</Heading>
              <Small>They're reviewing what you told us. We'll text you the moment they start the video visit. Keep this screen open or come back when you get the text.</Small>
              <ActivityIndicator color={color.navy} />
            </Card>
          ) : (
            <Card>
              <Heading>Your physician is ready</Heading>
              <Small>Find a quiet, private spot. Your visit is private and never recorded.</Small>
              <Button big title="Join video visit" onPress={() => router.push({ pathname: "/visit/[id]", params: { id: r.requestId } })} />
            </Card>
          )}
        </>
      ) : null}

      {r.status === "COMPLETED" ? (
        <>
          <Label>Visit complete</Label>
          <Title>{r.physician?.name ?? "Your visit"}</Title>
          {r.patientSummary ? (
            <Card>
              <Heading>Your visit summary</Heading>
              <Body>{r.patientSummary}</Body>
            </Card>
          ) : null}
          <Small>Your card has been charged. A receipt is on its way to your email.</Small>
        </>
      ) : null}

      {["CANCELLED", "EXPIRED", "PROVIDER_CANCELLED"].includes(r.status) ? (
        <>
          <Title>{r.status === "CANCELLED" ? "Request cancelled" : r.status === "EXPIRED" ? "No doctor was free just now" : "This request ended"}</Title>
          <Body>The hold on your card has been released. You weren't charged.</Body>
        </>
      ) : null}

      <Card>
        <Label>Payment</Label>
        <Row style={{ justifyContent: "space-between" }}>
          <Small>Visit</Small>
          <Small>{money(r.visitPriceCents)}</Small>
        </Row>
      </Card>
      <ErrorText>{error}</ErrorText>
      {r.status === "MATCHED" ? <Button title="Cancel visit" variant="ghost" loading={busy} onPress={cancel} /> : null}
      {DONE.includes(r.status) ? <Button title="Back to home" onPress={home} /> : null}
      <Notice>If your symptoms get worse or you think it's an emergency, call 911.</Notice>
    </Screen>
  );
}
