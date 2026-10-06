import React, { useState } from "react";
import { Switch } from "react-native";
import { router } from "expo-router";
import { Body, Button, Card, ErrorText, Heading, Notice, Row, Screen, Small } from "@ihealthe/shared";
import { api, BAA_VERSION } from "../lib/session";

/**
 * The legal text must come from iHealthé's healthcare attorney before launch.
 * This screen shows a plain-language summary and records acceptance with a version.
 */
export default function Baa() {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen>
      <Notice>Draft for review. The final agreement will be provided by iHealthé's attorney before launch.</Notice>
      <Card>
        <Heading>What this agreement covers</Heading>
        <Body>You are the healthcare provider. iHealthé is your business associate under HIPAA. It hosts your visits, intake forms and records on your behalf.</Body>
        <Small>• iHealthé protects patient information with encryption, access controls and audit logs.</Small>
        <Small>• iHealthé uses patient information only to run the platform for you, never to sell or advertise.</Small>
        <Small>• iHealthé tells you promptly about any security incident involving your patients' information.</Small>
        <Small>• iHealthé's vendors that handle patient information sign their own agreements.</Small>
        <Small>• When you leave, patient information is returned or kept as the law requires.</Small>
      </Card>
      <Small>Version {BAA_VERSION}</Small>
      <Row style={{ flexWrap: "nowrap" }}>
        <Switch value={agree} onValueChange={setAgree} accessibilityLabel="I agree to the Business Associate Agreement" />
        <Small style={{ flex: 1 }}>I have read and agree to the Business Associate Agreement.</Small>
      </Row>
      <ErrorText>{error}</ErrorText>
      <Button
        title="Sign agreement"
        disabled={!agree}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await api.physician.signBaa(BAA_VERSION);
            router.back();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
