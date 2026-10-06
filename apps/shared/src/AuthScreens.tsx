import React, { useState } from "react";
import { Auth, friendlyAuthError, type SignInResult } from "./auth";
import { Body, Button, ErrorText, Field, Notice, Screen, Small, Title } from "./ui";

type Mode = "signIn" | "signUp" | "confirm" | "mfa" | "newPassword";

/**
 * Shared sign-up / sign-in flow for both apps.
 * Sign-up asks only for what we need: name, email, mobile, password.
 * Cognito sends a verification code by email; MFA codes come by text or authenticator app.
 */
export function AuthFlow({
  auth,
  appName,
  tagline,
  onSignedIn,
  mfaNote,
}: {
  auth: Auth;
  appName: string;
  tagline: string;
  onSignedIn: () => void;
  mfaNote?: string;
}) {
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("+1");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Extract<SignInResult, { submit: unknown }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const handle = (r: SignInResult) => {
    setCode("");
    if (r.kind === "SIGNED_IN") onSignedIn();
    else if (r.kind === "NOT_CONFIRMED") {
      setMode("confirm");
      setInfo("Check your email for a verification code.");
      void auth.resendCode(email);
    } else {
      setPending(r);
      setMode(r.kind === "MFA_CODE" ? "mfa" : "newPassword");
      if (r.kind === "MFA_CODE") setInfo(r.channel === "SMS" ? "We texted you a 6-digit code." : "Enter the 6-digit code from your authenticator app.");
    }
  };

  if (mode === "confirm")
    return (
      <Screen>
        <Title>Verify your email</Title>
        {info ? <Notice>{info}</Notice> : null}
        <Field label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
        <ErrorText>{error}</ErrorText>
        <Button
          title="Verify"
          loading={busy}
          disabled={code.length < 6}
          onPress={() =>
            run(async () => {
              await auth.confirmSignUp(email, code);
              handle(await auth.signIn(email, password));
            })
          }
        />
        <Button title="Send a new code" variant="ghost" onPress={() => run(() => auth.resendCode(email))} />
      </Screen>
    );

  if (mode === "mfa" || mode === "newPassword")
    return (
      <Screen>
        <Title>{mode === "mfa" ? "Enter your code" : "Choose a new password"}</Title>
        {info && mode === "mfa" ? <Notice>{info}</Notice> : null}
        {mode === "mfa" ? (
          <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
        ) : (
          <Field label="New password" value={code} onChangeText={setCode} secureTextEntry autoComplete="new-password" />
        )}
        <ErrorText>{error}</ErrorText>
        <Button title="Continue" loading={busy} disabled={!code} onPress={() =>
            run(async () => {
              if (pending) handle(await pending.submit(code));
            })
          } />
      </Screen>
    );

  const signUp = mode === "signUp";
  return (
    <Screen>
      <Title>{appName}</Title>
      <Body>{tagline}</Body>
      {signUp ? (
        <>
          <Field label="First name" value={givenName} onChangeText={setGivenName} autoComplete="given-name" />
          <Field label="Last name" value={familyName} onChangeText={setFamilyName} autoComplete="family-name" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        </>
      ) : null}
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={signUp ? "new-password" : "current-password"} />
      {signUp ? <Small>At least 12 characters, with uppercase, lowercase and a number.</Small> : null}
      {signUp && mfaNote ? <Notice>{mfaNote}</Notice> : null}
      <ErrorText>{error}</ErrorText>
      <Button
        title={signUp ? "Create account" : "Sign in"}
        loading={busy}
        disabled={!email || !password || (signUp && (!givenName || !familyName || phone.length < 10))}
        onPress={() =>
          run(async () => {
            if (signUp) {
              await auth.signUp({ email, password, phone, givenName, familyName });
              setInfo("We sent a verification code to your email.");
              setMode("confirm");
            } else handle(await auth.signIn(email, password));
          })
        }
      />
      <Button
        title={signUp ? "I already have an account" : "Create an account"}
        variant="ghost"
        onPress={() => {
          setError(null);
          setMode(signUp ? "signIn" : "signUp");
        }}
      />
    </Screen>
  );
}
