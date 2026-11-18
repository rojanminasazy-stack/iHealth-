import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, View } from "react-native";
import { router } from "expo-router";
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
  Small,
  space,
  specialtyName,
  type PhysicianCard,
} from "@ihealthe/shared";
import { api, useIntake } from "../lib/session";
import { CLIENT, usePay } from "../lib/pay";

const LANG: Record<string, string> = { en: "English", es: "Spanish", fa: "Farsi", zh: "Chinese" };

/**
 * Uber-style: the default is "match me with the first available doctor".
 * Patients can still pick a specific doctor who's online right now.
 */
export default function Choose() {
  const { intake } = useIntake();
  const pay = usePay();
  const [list, setList] = useState<PhysicianCard[] | null>(null);
  const [picked, setPicked] = useState<PhysicianCard | null>(null);
  const [notEmergency, setNotEmergency] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!intake) return;
    setError(null);
    try {
      const r = await api.patient.physicians({
        state: intake.patientState,
        specialty: intake.specialty,
        ageGroup: intake.ageGroup,
        language: intake.language ?? "en",
      });
      setList(r.physicians);
      setPicked((p) => (p && r.physicians.some((x) => x.providerId === p.providerId) ? p : null));
    } catch (e) {
      setError((e as Error).message);
      setList([]);
    }
  }, [intake]);

  // Like a ride app's map: refresh who's online every 15 seconds.
  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (!intake) {
    router.replace("/intake");
    return null;
  }

  const price = list?.[0]?.quote.totalCents ?? 7_900;
  const online = list?.length ?? 0;

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.patient.createRequest({
        providerId: picked?.providerId,
        client: CLIENT,
        patientState: intake.patientState,
        ageGroup: intake.ageGroup,
        specialty: intake.specialty,
        chiefComplaint: intake.chiefComplaint,
        symptomDuration: intake.symptomDuration,
        emergencyAcknowledged: true,
      });
      const result = await pay(created);
      if (result === "redirected") return; // website: Stripe brings the patient back to the request page
      if (result === "cancelled") {
        await api.patient.cancel(created.requestId).catch(() => {});
        return;
      }
      router.replace({ pathname: "/request/[id]", params: { id: created.requestId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Card style={{ backgroundColor: color.navy, borderColor: color.navy }}>
          <Label>Available now</Label>
          {list === null ? (
            <ActivityIndicator color={color.white} />
          ) : (
            <Heading>
              <Body style={{ color: color.white, fontSize: 22, fontWeight: "700" }}>
                {online === 0 ? `No doctors online in ${intake.patientState} right now` : `${online} doctor${online === 1 ? "" : "s"} online in ${intake.patientState}`}
              </Body>
            </Heading>
          )}
          <Small style={{ color: "#D4DDEF" }}>{`${specialtyName(intake.specialty)} · 20-minute video visit · ${money(price)}`}</Small>
        </Card>

        <Pressable onPress={() => setPicked(null)} accessibilityRole="radio" accessibilityState={{ selected: picked === null }}>
          <Card style={picked === null ? { borderColor: color.navy, borderWidth: 2 } : undefined}>
            <Row style={{ justifyContent: "space-between" }}>
              <Heading>First available doctor</Heading>
              <Pill tone="good" text="FASTEST" />
            </Row>
            <Small>We'll connect you with the first verified doctor licensed in your state who accepts.</Small>
          </Card>
        </Pressable>

        {online > 0 ? <Label>Or choose a doctor</Label> : null}
        {list?.map((p) => {
          const on = picked?.providerId === p.providerId;
          return (
            <Pressable key={p.providerId} onPress={() => setPicked(p)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Card style={on ? { borderColor: color.navy, borderWidth: 2 } : undefined}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Heading>{p.name}</Heading>
                  {p.rating ? <Pill text={`★ ${p.rating.toFixed(1)}`} /> : null}
                </Row>
                <Row>
                  <Pill tone="good" text="LICENSE VERIFIED" />
                  <Pill text={specialtyName(p.specialty)} />
                </Row>
                <Small>Speaks {p.languages.map((l) => LANG[l] ?? l).join(", ")}</Small>
              </Card>
            </Pressable>
          );
        })}
        {online === 0 && list !== null ? <Notice>Doctors come online throughout the day. Pull down to refresh, or try again in a few minutes.</Notice> : null}
      </ScrollView>

      <View style={{ padding: space.lg, gap: space.md, backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Body style={{ fontWeight: "700" }}>{picked ? picked.name : "First available doctor"}</Body>
          <Body style={{ fontWeight: "700" }}>{money(price)}</Body>
        </Row>
        <Row style={{ flexWrap: "nowrap" }}>
          <Switch value={notEmergency} onValueChange={setNotEmergency} accessibilityLabel="This is not an emergency" />
          <Small style={{ flex: 1 }}>This is not an emergency. If it were, I would call 911.</Small>
        </Row>
        <Small>Your card is held now and charged only after your visit. If no doctor accepts, the hold is released.</Small>
        <ErrorText>{error}</ErrorText>
        <Button big title={picked ? `Request ${picked.name.split(",")[0]}` : "Find my doctor"} loading={busy} disabled={!notEmergency || online === 0} onPress={request} />
      </View>
    </View>
  );
}
