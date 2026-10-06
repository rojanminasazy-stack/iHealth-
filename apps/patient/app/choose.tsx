import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, View } from "react-native";
import { router } from "expo-router";
import { useStripe } from "@stripe/stripe-react-native";
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

export default function Choose() {
  const { intake } = useIntake();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
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
    } catch (e) {
      setError((e as Error).message);
      setList([]);
    }
  }, [intake]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!intake) {
    router.replace("/intake");
    return null;
  }

  const book = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.patient.createRequest({
        providerId: picked.providerId,
        patientState: intake.patientState,
        ageGroup: intake.ageGroup,
        specialty: intake.specialty,
        chiefComplaint: intake.chiefComplaint,
        symptomDuration: intake.symptomDuration,
        emergencyAcknowledged: true,
      });
      const init = await initPaymentSheet({
        merchantDisplayName: "iHealthé",
        paymentIntentClientSecret: created.paymentClientSecret,
        applePay: { merchantCountryCode: "US" },
        googlePay: { merchantCountryCode: "US", testEnv: __DEV__ },
      });
      if (init.error) throw new Error(init.error.message);
      const paid = await presentPaymentSheet();
      if (paid.error) {
        // Patient closed the sheet or the card failed: release the request.
        await api.patient.cancel(created.requestId).catch(() => {});
        if (paid.error.code !== "Canceled") setError(paid.error.message);
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
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      >
        <Small>
          Licensed in {intake.patientState} · {specialtyName(intake.specialty)} · {intake.ageGroup === "CHILD" ? "Child" : "Adult"}
        </Small>
        {list === null ? <ActivityIndicator color={color.navy} /> : null}
        {list?.length === 0 && !error ? (
          <Card>
            <Heading>No physicians online right now</Heading>
            <Body>Nobody licensed in {intake.patientState} for this type of care is available at the moment. Pull down to refresh, or try again soon.</Body>
          </Card>
        ) : null}
        {list?.map((p) => {
          const on = picked?.providerId === p.providerId;
          return (
            <Pressable key={p.providerId} onPress={() => setPicked(p)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Card style={on ? { borderColor: color.navy, borderWidth: 2 } : undefined}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Heading>{p.name}</Heading>
                  <Body style={{ fontWeight: "700", color: color.navy }}>{money(p.visitPriceCents)}</Body>
                </Row>
                <Row>
                  <Pill tone="good" text="LICENSE VERIFIED" />
                  <Pill text={specialtyName(p.specialty)} />
                  {p.rating ? <Pill text={`★ ${p.rating.toFixed(1)}`} /> : null}
                </Row>
                <Small>Speaks {p.languages.map((l) => ({ en: "English", es: "Spanish", fa: "Farsi", zh: "Chinese" })[l] ?? l).join(", ")}</Small>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>

      {picked ? (
        <View style={{ padding: space.lg, gap: space.md, backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line }}>
          <Label>Your total</Label>
          <Row style={{ justifyContent: "space-between" }}>
            <Small>Visit with {picked.name}</Small>
            <Small>{money(picked.quote.visitPriceCents)}</Small>
          </Row>
          <Row style={{ justifyContent: "space-between" }}>
            <Small>iHealthé booking fee</Small>
            <Small>{money(picked.quote.bookingFeeCents)}</Small>
          </Row>
          <Row style={{ justifyContent: "space-between" }}>
            <Body style={{ fontWeight: "700" }}>Total</Body>
            <Body style={{ fontWeight: "700" }}>{money(picked.quote.totalCents)}</Body>
          </Row>
          <Row style={{ flexWrap: "nowrap" }}>
            <Switch value={notEmergency} onValueChange={setNotEmergency} accessibilityLabel="This is not an emergency" />
            <Small style={{ flex: 1 }}>This is not an emergency. If it were, I would call 911.</Small>
          </Row>
          <Notice>Your card is held now and charged only after your visit.</Notice>
          <ErrorText>{error}</ErrorText>
          <Button title={`Request ${picked.name.split(",")[0]}`} loading={busy} disabled={!notEmergency} onPress={book} />
        </View>
      ) : (
        <View style={{ padding: space.lg }}>
          <ErrorText>{error}</ErrorText>
        </View>
      )}
    </View>
  );
}
