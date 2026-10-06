import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
  type ICognitoStorage,
} from "amazon-cognito-identity-js";
import * as SecureStore from "expo-secure-store";

/**
 * Tokens live in the iOS Keychain / Android Keystore via expo-secure-store,
 * never in plain AsyncStorage. SecureStore is async, so we keep an in-memory
 * mirror that Cognito reads synchronously and hydrate it at startup.
 */
class SecureStorage implements ICognitoStorage {
  private mem = new Map<string, string>();
  private indexKey: string;
  constructor(private prefix: string) {
    this.indexKey = `${prefix}.index`;
  }
  private safe = (k: string) => `${this.prefix}.${k.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  async hydrate() {
    const idx = await SecureStore.getItemAsync(this.indexKey);
    for (const k of idx ? (JSON.parse(idx) as string[]) : []) {
      const v = await SecureStore.getItemAsync(this.safe(k));
      if (v != null) this.mem.set(k, v);
    }
  }
  private persistIndex() {
    void SecureStore.setItemAsync(this.indexKey, JSON.stringify([...this.mem.keys()]));
  }
  setItem(k: string, v: string) {
    this.mem.set(k, v);
    void SecureStore.setItemAsync(this.safe(k), v, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    this.persistIndex();
    return v;
  }
  getItem(k: string) {
    return this.mem.get(k) ?? null;
  }
  removeItem(k: string) {
    this.mem.delete(k);
    void SecureStore.deleteItemAsync(this.safe(k));
    this.persistIndex();
    return true;
  }
  clear() {
    for (const k of [...this.mem.keys()]) this.removeItem(k);
    return {};
  }
}

export type SignInResult =
  | { kind: "SIGNED_IN" }
  | { kind: "MFA_CODE"; channel: "SMS" | "APP"; submit: (code: string) => Promise<SignInResult> }
  | { kind: "NEW_PASSWORD"; submit: (password: string) => Promise<SignInResult> }
  | { kind: "NOT_CONFIRMED" };

/** Turns Cognito errors into plain sentences. Never reveals whether an email exists. */
export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string; name?: string })?.code ?? (err as { name?: string })?.name;
  switch (code) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "Email or password is incorrect.";
    case "UsernameExistsException":
      return "An account with this email already exists. Try signing in.";
    case "CodeMismatchException":
      return "That code isn't right. Check it and try again.";
    case "ExpiredCodeException":
      return "That code expired. Request a new one.";
    case "InvalidPasswordException":
      return "Use at least 12 characters with an uppercase letter, a lowercase letter and a number.";
    case "InvalidParameterException":
      return "Check your email and phone number. Phone numbers need the country code, like +16615550123.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Wait a few minutes and try again.";
    default:
      return "Something went wrong. Check your connection and try again.";
  }
}

export class Auth {
  private pool: CognitoUserPool;
  private storage: SecureStorage;
  private ready: Promise<void>;

  constructor(cfg: { userPoolId: string; clientId: string; storagePrefix: string }) {
    this.storage = new SecureStorage(cfg.storagePrefix);
    this.pool = new CognitoUserPool({ UserPoolId: cfg.userPoolId, ClientId: cfg.clientId, Storage: this.storage });
    this.ready = this.storage.hydrate();
  }

  private user(email: string) {
    return new CognitoUser({ Username: email.trim().toLowerCase(), Pool: this.pool, Storage: this.storage });
  }

  async signUp(input: { email: string; password: string; phone: string; givenName: string; familyName: string }): Promise<void> {
    await this.ready;
    const attrs = [
      new CognitoUserAttribute({ Name: "email", Value: input.email.trim().toLowerCase() }),
      new CognitoUserAttribute({ Name: "phone_number", Value: input.phone.trim() }),
      new CognitoUserAttribute({ Name: "given_name", Value: input.givenName.trim() }),
      new CognitoUserAttribute({ Name: "family_name", Value: input.familyName.trim() }),
    ];
    await new Promise<void>((res, rej) =>
      this.pool.signUp(input.email.trim().toLowerCase(), input.password, attrs, [], (err) => (err ? rej(err) : res())),
    );
  }

  /** Confirms the email code Cognito sent at sign-up. */
  async confirmSignUp(email: string, code: string): Promise<void> {
    await this.ready;
    await new Promise<void>((res, rej) => this.user(email).confirmRegistration(code.trim(), true, (err) => (err ? rej(err) : res())));
  }

  async resendCode(email: string): Promise<void> {
    await this.ready;
    await new Promise<void>((res, rej) => this.user(email).resendConfirmationCode((err) => (err ? rej(err) : res())));
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    await this.ready;
    const u = this.user(email);
    const details = new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password });
    return new Promise<SignInResult>((resolve, reject) => {
      const callbacks = {
        onSuccess: () => resolve({ kind: "SIGNED_IN" } as SignInResult),
        onFailure: (err: { code?: string }) => {
          if (err?.code === "UserNotConfirmedException") resolve({ kind: "NOT_CONFIRMED" });
          else reject(err);
        },
        mfaRequired: () =>
          resolve({
            kind: "MFA_CODE",
            channel: "SMS",
            submit: (code: string) =>
              new Promise<SignInResult>((res2, rej2) =>
                u.sendMFACode(code.trim(), { onSuccess: () => res2({ kind: "SIGNED_IN" }), onFailure: rej2 }),
              ),
          }),
        totpRequired: () =>
          resolve({
            kind: "MFA_CODE",
            channel: "APP",
            submit: (code: string) =>
              new Promise<SignInResult>((res2, rej2) =>
                u.sendMFACode(code.trim(), { onSuccess: () => res2({ kind: "SIGNED_IN" }), onFailure: rej2 }, "SOFTWARE_TOKEN_MFA"),
              ),
          }),
        newPasswordRequired: () =>
          resolve({
            kind: "NEW_PASSWORD",
            submit: (pw: string) =>
              new Promise<SignInResult>((res2, rej2) =>
                u.completeNewPasswordChallenge(pw, {}, { onSuccess: () => res2({ kind: "SIGNED_IN" }), onFailure: rej2 }),
              ),
          }),
      };
      u.authenticateUser(details, callbacks);
    });
  }

  /** Current ID token (refreshes if needed). The API reads email/phone from it for notifications. */
  async idToken(): Promise<string | null> {
    await this.ready;
    const u = this.pool.getCurrentUser();
    if (!u) return null;
    return new Promise((resolve) =>
      u.getSession((err: Error | null, session: CognitoUserSession | null) =>
        resolve(err || !session?.isValid() ? null : session.getIdToken().getJwtToken()),
      ),
    );
  }

  async isSignedIn(): Promise<boolean> {
    return (await this.idToken()) !== null;
  }

  async signOut(): Promise<void> {
    await this.ready;
    const u = this.pool.getCurrentUser();
    if (!u) return;
    // Revokes the refresh token on the server too, so a stolen token stops working.
    await new Promise<void>((res) => u.globalSignOut({ onSuccess: () => res(), onFailure: () => (u.signOut(), res()) }));
  }
}
