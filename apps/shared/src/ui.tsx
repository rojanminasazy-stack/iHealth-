import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { color, radius, space, type } from "./theme";

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const inner = <View style={s.screenInner}>{children}</View>;
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">{inner}</ScrollView> : inner}
    </KeyboardAvoidingView>
  );
}

export const Title = ({ children }: { children: React.ReactNode }) => <Text style={type.title} accessibilityRole="header">{children}</Text>;
export const Heading = ({ children }: { children: React.ReactNode }) => <Text style={type.heading} accessibilityRole="header">{children}</Text>;
export const Body = ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={[type.body, style]}>{children}</Text>;
export const Small = ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={[type.small, style]}>{children}</Text>;
export const Label = ({ children }: { children: React.ReactNode }) => <Text style={type.label}>{children}</Text>;

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  big,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  big?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn,
        big && s.btnBig,
        variant === "ghost" && s.btnGhost,
        variant === "danger" && s.btnDanger,
        (pressed || off) && { opacity: off ? 0.45 : 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "ghost" ? color.navy : color.white} />
      ) : (
        <Text style={[s.btnText, big && { fontSize: 18 }, variant === "ghost" && { color: color.navy }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, ...rest }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={color.muted}
        style={[s.input, rest.multiline && { minHeight: 96, textAlignVertical: "top" }, !!error && { borderColor: color.bad }]}
        {...rest}
      />
      {error ? <Text style={{ color: color.bad, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { code: T; name: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = o.code === value;
        return (
          <Pressable
            key={o.code}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.code)}
            style={[s.chip, on && s.chipOn]}
          >
            <Text style={[s.chipText, on && { color: color.white }]}>{o.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Pill({ text, tone = "info" }: { text: string; tone?: "good" | "warn" | "bad" | "info" }) {
  const fg = { good: color.good, warn: color.warn, bad: color.bad, info: color.navy }[tone];
  return (
    <View style={[s.pill, { backgroundColor: fg + "1F" }]}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 }}>{text}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <View style={s.error} accessibilityRole="alert">
      <Text style={{ color: color.bad }}>{children}</Text>
    </View>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.notice}>
      <Text style={type.small}>{children}</Text>
    </View>
  );
}

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }, style]}>{children}</View>
);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  screenInner: { padding: space.lg, gap: space.lg, flexGrow: 1 },
  btn: { backgroundColor: color.navy, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center", minHeight: 48 },
  btnBig: { paddingVertical: 20 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.line },
  btnDanger: { backgroundColor: color.bad },
  btnText: { color: color.white, fontSize: 16, fontWeight: "700" },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: color.ink },
  input: { borderWidth: 1, borderColor: color.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16, color: color.ink, backgroundColor: color.surface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface },
  chipOn: { backgroundColor: color.navy, borderColor: color.navy },
  chipText: { fontSize: 14, fontWeight: "600", color: color.ink },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, padding: space.lg, gap: space.sm },
  pill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  error: { backgroundColor: color.bad + "14", borderRadius: radius.sm, padding: space.md },
  notice: { backgroundColor: color.soft, borderRadius: radius.sm, padding: space.md },
});
