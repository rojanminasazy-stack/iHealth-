import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Switch, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import {
  ApiError,
  Body,
  Button,
  Card,
  color,
  ErrorText,
  Field,
  Heading,
  Label,
  money,
  Notice,
  Pill,
  Row,
  Small,
  space,
  specialtyName,
  Title,
  type OpenRequest,
  type PhysicianSelf,
  type PhysicianVisit,
} from "@ihealthe/shared";
import { api } from "../lib/session";

const STATUS_PILL: Record<PhysicianSelf["status"], { text: string; tone: "good" | "warn" | "bad" | "info" }> = {
  APPLIED: { text: "APPLICATION RECEIVED", tone: "warn" },
  UNDER_REVIEW: { text: "CREDENTIALS UNDER REVIEW", tone: "warn" },
  APPROVED: { text: "APPROVED", tone: "good" },
  ACTIVE: { text: "ACTIVE", tone: "good" },
  REJECTED: { text: "NOT APPROVED", tone: "bad" },
  SUSPENDED: { text: "SUSPENDED", tone: "bad" },
};

export default function Home() {
  const [me, setMe] = useState<PhysicianSelf | null | "none">(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMe(await api.physician.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMe("none");
      else setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (me === null)
    return (
      <View style={{ padding: space.lg, gap: space.md }}>
        <ActivityIndicator color={color.navy} />
        <ErrorText>{error}</ErrorText>
        {error ? <Button title="Try again" onPress={load} /> : null}
      </View>
    );

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
    >
      {me === "none" ? <Welcome /> : <Dashboard me={me} reload={load} />}
      <ErrorText>{error}</ErrorText>
      <Button title="Account" variant="ghost" onPress={() => router.push("/account")} />
    </ScrollView>
  );
}

function Welcome() {
  return (
    <>
      <Label>Join the network</Label>
      <Title>See patients on iHealthé</Title>
      <Card>
        <Small>• Patients in states where you're licensed choose you and pay you directly.</Small>
        <Small>• You set your own visit price and hours. Go online whenever you want.</Small>
        <Small>• Founding physicians get 90 days free, then $99/month for life.</Small>
      </Card>
      <Button big title="Start application" onPress={() => router.push("/apply")} />
    </>
  );
}

function Dashboard({ me, reload }: { me: PhysicianSelf; reload: () => Promise<void> }) {
  const pill = STATUS_PILL[me.status];
  return (
    <>
      <Row style={{ justifyContent: "space-between" }}>
        <Heading>{`${me.fullName}, ${me.credentials}`}</Heading>
        <Pill text={pill.text} tone={pill.tone} />
      </Row>
      <Small>
        {specialtyName(me.specialty)} · Licensed in {me.licenses.map((l) => l.state).join(", ")}
        {me.founding ? " · Founding Physician" : ""}
      </Small>

      {me.status === "APPLIED" || me.status === "UNDER_REVIEW" ? <UnderReview me={me} reload={reload} /> : null}
      {me.status === "APPROVED" ? <NextSteps me={me} reload={reload} /> : null}
      {me.status === "ACTIVE" ? <Active me={me} reload={reload} /> : null}
      {me.status === "REJECTED" ? (
        <Card>
          <Body>We weren't able to approve your application. Email providers@ihealthe.net if you have questions.</Body>
        </Card>
      ) : null}
      {me.status === "SUSPENDED" ? (
        <Card>
          <Body>Your account is paused, so you can't receive patients right now. Email providers@ihealthe.net to sort it out.</Body>
        </Card>
      ) : null}
    </>
  );
}

function ResumeUpload({ me, reload }: { me: PhysicianSelf; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pick = async () => {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const file = res.assets[0];
    setBusy(true);
    try {
      const { uploadUrl, maxBytes } = await api.physician.resumeUploadUrl();
      if (file.size && file.size > maxBytes) throw new Error("Your file is over 10 MB. Upload a smaller PDF.");
      const blob = await (await fetch(file.uri)).blob();
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: blob });
      if (!put.ok) throw new Error("Upload didn't finish. Try again.");
      setDone(true);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Heading>Resume or CV</Heading>
      <Small>{me.resumeUploaded || done ? "Uploaded. You can replace it any time." : "Upload a PDF so our team can review your experience."}</Small>
      <ErrorText>{error}</ErrorText>
      <Button title={me.resumeUploaded || done ? "Replace PDF" : "Upload PDF"} variant={me.resumeUploaded ? "ghost" : "primary"} loading={busy} onPress={pick} />
    </Card>
  );
}

function UnderReview({ me, reload }: { me: PhysicianSelf; reload: () => Promise<void> }) {
  return (
    <>
      <Card>
        <Heading>We're reviewing your application</Heading>
        <Small>We're checking your license with the state medical board and confirming your NPI. You'll get an email and text when we're done.</Small>
        {me.licenses.map((l) => (
          <Row key={l.state}>
            <Pill text={l.state} />
            <Small>{l.number} · expires {l.expiresOn}</Small>
            <Pill text={l.verified ? "VERIFIED" : "CHECKING"} tone={l.verified ? "good" : "warn"} />
          </Row>
        ))}
      </Card>
      <ResumeUpload me={me} reload={reload} />
    </>
  );
}

function NextSteps({ me, reload }: { me: PhysicianSelf; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payouts = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.physician.payoutsLink();
      await WebBrowser.openBrowserAsync(url);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const plan = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.physician.subscription();
      await WebBrowser.openBrowserAsync(url);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Notice>You're approved. Finish these three steps and you can go online.</Notice>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Heading>1. Sign the agreement</Heading>
          <Pill text={me.baaSigned ? "DONE" : "TO DO"} tone={me.baaSigned ? "good" : "warn"} />
        </Row>
        <Small>A HIPAA Business Associate Agreement between you and iHealthé.</Small>
        {!me.baaSigned ? <Button title="Review and sign" onPress={() => router.push("/baa")} /> : null}
      </Card>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Heading>2. Set up payouts</Heading>
          <Pill text={me.payoutsReady ? "DONE" : "TO DO"} tone={me.payoutsReady ? "good" : "warn"} />
        </Row>
        <Small>Patients pay you through Stripe. Stripe verifies your identity and bank account and sends your tax forms.</Small>
        {!me.payoutsReady ? <Button title="Set up with Stripe" loading={busy} onPress={payouts} /> : null}
      </Card>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Heading>3. Start your plan</Heading>
          <Pill text={me.subscriptionReady ? "DONE" : "TO DO"} tone={me.subscriptionReady ? "good" : "warn"} />
        </Row>
        <Small>
          {me.plan.trialDays > 0
            ? `${me.plan.label}: free for ${me.plan.trialDays} days, then ${money(me.plan.priceCents)}/month. You won't be charged today.`
            : `${me.plan.label}: ${money(me.plan.priceCents)}/month. Cancel any time.`}
        </Small>
        {!me.subscriptionReady ? <Button title="Start plan" loading={busy} onPress={plan} /> : null}
      </Card>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

function Active({ me, reload }: { me: PhysicianSelf; reload: () => Promise<void> }) {
  const [online, setOnline] = useState(me.online);
  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [visits, setVisits] = useState<PhysicianVisit[]>([]);
  const [price, setPrice] = useState(String(me.visitPriceCents / 100));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadVisits = useCallback(async () => {
    try {
      setVisits((await api.physician.visits()).visits);
    } catch {
      /* shown on next refresh */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadVisits();
    }, [loadVisits]),
  );

  const poll = useCallback(async () => {
    try {
      setRequests((await api.physician.openRequests()).requests);
    } catch {
      /* keep the last list; the next poll will retry */
    }
  }, []);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (online) {
      void poll();
      timer.current = setInterval(poll, 5000);
    } else setRequests([]);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [online, poll]);

  const toggle = async (next: boolean) => {
    setError(null);
    setOnline(next);
    try {
      await api.physician.setOnline(next);
    } catch (e) {
      setOnline(!next);
      setError((e as Error).message);
    }
  };

  const accept = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api.physician.accept(id);
      setNotice("Accepted. Start the video when you're ready.");
      setRequests((rs) => rs.filter((r) => r.requestId !== id));
      void loadVisits();
    } catch (e) {
      setError((e as Error).message);
      void poll();
    } finally {
      setBusy(null);
    }
  };

  const savePrice = async () => {
    setBusy("price");
    setError(null);
    try {
      await api.physician.setPrice(Math.round(Number(price) * 100));
      setNotice("Price updated.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card style={{ backgroundColor: online ? color.good + "14" : color.surface }}>
        <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}>
            <Heading>{online ? "You're online" : "You're offline"}</Heading>
            <Small>{online ? "Patients can find and request you." : "Go online to receive patient requests."}</Small>
          </View>
          <Switch value={online} onValueChange={toggle} accessibilityLabel="Online" />
        </Row>
      </Card>

      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorText>{error}</ErrorText>

      {visits.length > 0 ? (
        <>
          <Label>Your visits</Label>
          {visits.map((v) => (
            <Card key={v.requestId}>
              <Row>
                <Pill tone={v.status === "IN_VISIT" ? "good" : "info"} text={v.status === "IN_VISIT" ? "IN PROGRESS" : "READY TO START"} />
                <Pill text={v.ageGroup === "CHILD" ? "Child" : "Adult"} />
                <Pill text={`Patient in ${v.patientState}`} />
              </Row>
              <Body>{v.chiefComplaint}</Body>
              <Small>Started: {v.symptomDuration} · {specialtyName(v.specialty)}</Small>
              <Notice>{`Confirm with the patient that they are in ${v.patientState} right now before you begin.`}</Notice>
              <Button
                title={v.status === "IN_VISIT" ? "Rejoin video" : "Start video visit"}
                onPress={() => router.push({ pathname: "/visit/[id]", params: { id: v.requestId } })}
              />
            </Card>
          ))}
        </>
      ) : null}

      {online ? (
        <>
          <Label>Patient requests</Label>
          {requests.length === 0 ? <Small>No requests yet. New ones appear here automatically.</Small> : null}
          {requests.map((r) => (
            <Card key={r.requestId}>
              <Row>
                <Pill text="NEW REQUEST" />
                <Pill text={r.ageGroup === "CHILD" ? "Child" : "Adult"} />
                <Pill text={`Patient in ${r.patientState}`} />
              </Row>
              <Body>{r.chiefComplaint}</Body>
              <Small>Started: {r.symptomDuration} · {specialtyName(r.specialty)} · Video</Small>
              <Small>You receive {money(r.youReceiveCents)}</Small>
              <Button title="Accept" loading={busy === r.requestId} onPress={() => accept(r.requestId)} />
            </Card>
          ))}
        </>
      ) : null}

      <Card>
        <Heading>Your visit price</Heading>
        <Field label="Price in USD" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <Small>Between $25 and $300. Patients see this before booking.</Small>
        <Button title="Save price" variant="ghost" loading={busy === "price"} onPress={savePrice} />
      </Card>

      <Card>
        <Heading>Your plan</Heading>
        <Small>{`${me.plan.label} · ${money(me.plan.priceCents)}/month${me.subscriptionStatus === "trialing" ? " · free trial" : ""}${me.subscriptionStatus === "past_due" ? " · payment problem" : ""}`}</Small>
        <Button
          title="Manage plan or card"
          variant="ghost"
          loading={busy === "plan"}
          onPress={async () => {
            setBusy("plan");
            try {
              const { url } = await api.physician.subscription();
              await WebBrowser.openBrowserAsync(url);
              await reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        />
      </Card>
    </>
  );
}
