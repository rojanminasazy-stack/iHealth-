import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Button, color, ErrorText, radius, Small, space } from "@ihealthe/shared";
import { api } from "../lib/session";

type Msg = { role: "user" | "assistant"; content: string; urgent?: boolean };

const STARTERS = [
  "What's the difference between a cold and the flu?",
  "When should I worry about a fever?",
  "How can I sleep better?",
  "How does an iHealthé visit work?",
];

const WELCOME =
  "Hi! I'm iHealthé's AI assistant. Ask me a simple health question. I can't diagnose you or prescribe medicine, but I can explain things and tell you when it's time to see a doctor.";

/**
 * AI health questions. The chat lives only in this screen's memory:
 * it isn't saved on the phone or on our servers, and it's gone when you leave.
 */
export default function Ask() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  const send = async (q?: string) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question.slice(0, 1000) }];
    setMsgs(next);
    setText("");
    setError(null);
    setBusy(true);
    try {
      const r = await api.patient.ask(next.map(({ role, content }) => ({ role, content })));
      setMsgs([...next, { role: "assistant", content: r.answer, urgent: r.urgent }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Bubble role="assistant" content={WELCOME} />
        {msgs.length === 0
          ? STARTERS.map((s) => (
              <Button key={s} title={s} variant="ghost" onPress={() => send(s)} />
            ))
          : null}
        {msgs.map((m, i) => (
          <View key={i} style={{ gap: space.sm }}>
            <Bubble role={m.role} content={m.content} urgent={m.urgent} />
            {m.urgent ? <Button title="Close chat" variant="danger" onPress={() => router.back()} /> : null}
          </View>
        ))}
        {busy ? <Small>Thinking…</Small> : null}
        <ErrorText>{error}</ErrorText>
      </ScrollView>

      <View style={{ padding: space.md, gap: space.sm, backgroundColor: color.surface, borderTopWidth: 1, borderColor: color.line }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type your question"
            placeholderTextColor={color.muted}
            accessibilityLabel="Your question"
            multiline
            maxLength={1000}
            style={{ flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: color.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: color.ink, backgroundColor: color.surface }}
          />
          <View style={{ width: 84 }}>
            <Button title="Send" loading={busy} disabled={!text.trim()} onPress={() => send()} />
          </View>
        </View>
        <Button title="See a doctor now" variant="ghost" onPress={() => router.replace("/intake")} />
        <Small>AI answers aren't medical advice. Don't share your name, birthday or address here. In an emergency, call 911.</Small>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ role, content, urgent }: Msg) {
  const mine = role === "user";
  const [answer, notice] = mine ? [content, ""] : splitNotice(content);
  return (
    <View
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: "88%",
        backgroundColor: mine ? color.navy : urgent ? "#FBEAEA" : color.surface,
        borderColor: urgent ? color.bad : color.line,
        borderWidth: mine ? 0 : 1,
        borderRadius: radius.lg,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <Text style={{ color: mine ? color.white : color.ink, fontSize: 16, lineHeight: 22, fontWeight: urgent ? "700" : "400" }}>{answer}</Text>
      {notice ? <Text style={{ color: color.muted, fontSize: 12, lineHeight: 17, fontStyle: "italic" }}>{notice}</Text> : null}
    </View>
  );
}

/** The server always adds the AI notice as the last paragraph; show it smaller under the answer. */
function splitNotice(s: string): [string, string] {
  const i = s.lastIndexOf("\n\nThis answer came from iHealthé's AI assistant");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 2)];
}
