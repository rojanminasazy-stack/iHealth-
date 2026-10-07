import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
  type ICognitoStorage,
} from "amazon-cognito-identity-js";

/**
 * Credentialing portal for iHealthé staff. Staff accounts are created by an admin (no self sign-up),
 * require MFA, and must be in the "credentialing" group. Tokens live in sessionStorage so closing
 * the tab signs you out. Everything rendered from the API uses textContent, never innerHTML.
 */
interface Config { apiUrl: string; staffPoolId: string; staffClientId: string }
interface License { state: string; number: string; expiresOn: string; verifiedAt?: string; verificationSource?: string }
interface Provider {
  providerId: string; fullName: string; credentials: string; npi: string; specialty: string;
  licenses: License[]; status: string; resumeUploaded: boolean; createdAt: string;
}

const STATUSES = ["APPLIED", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUSPENDED", "REJECTED"] as const;
const BOARD_LOOKUP: Record<string, string> = {
  CA: "https://search.dca.ca.gov/",
  TX: "https://profile.tmb.state.tx.us/",
  NY: "https://www.op.nysed.gov/verification-search",
  FL: "https://mqa-internet.doh.state.fl.us/MQASearchServices/HealthCareProviders",
  AZ: "https://azbomprod.azmd.gov/GLSuiteWeb/Clients/AZBOM/Public/LicenseeSearch.aspx",
  NV: "https://nsbme.us.thentiacloud.net/webs/nsbme/register/",
  OR: "https://omb.oregon.gov/search",
  WA: "https://fortress.wa.gov/doh/providercredentialsearch/",
};

const sessionStore: ICognitoStorage = {
  setItem: (k, v) => sessionStorage.setItem(k, v),
  getItem: (k) => sessionStorage.getItem(k),
  removeItem: (k) => sessionStorage.removeItem(k),
  clear: () => sessionStorage.clear(),
};

/** Tiny DOM helper: text is always set with textContent. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...kids: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of kids) if (c !== null && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

const app = document.getElementById("app")!;
const signoutBtn = document.getElementById("signout") as HTMLButtonElement;
const render = (...nodes: Node[]) => app.replaceChildren(...nodes);
const errorBox = (msg: string) => h("p", { class: "error", role: "alert" }, msg);

let cfg: Config;
let pool: CognitoUserPool;

async function idToken(): Promise<string | null> {
  const u = pool.getCurrentUser();
  if (!u) return null;
  return new Promise((res) => u.getSession((err: Error | null, s: CognitoUserSession | null) => res(err || !s?.isValid() ? null : s.getIdToken().getJwtToken())));
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await idToken();
  if (!token) { showSignIn("Your session ended. Sign in again."); throw new Error("signed out"); }
  const r = await fetch(cfg.apiUrl + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data as T;
}

function authError(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === "NotAuthorizedException" || code === "UserNotFoundException") return "Email or password is incorrect.";
  if (code === "CodeMismatchException") return "That code isn't right.";
  if (code === "InvalidPasswordException") return "Use at least 12 characters with uppercase, lowercase and a number.";
  return "Sign-in failed. Try again.";
}

function showSignIn(message?: string) {
  signoutBtn.hidden = true;
  const email = h("input", { id: "email", type: "email", autocomplete: "username", required: true });
  const pw = h("input", { id: "pw", type: "password", autocomplete: "current-password", required: true });
  const err = h("div");
  const form = h("form", { class: "card stack", style: "max-width:420px" },
    h("h2", {}, "Staff sign in"),
    message ? h("p", { class: "notice" }, message) : null,
    h("label", { for: "email" }, "Work email", email),
    h("label", { for: "pw" }, "Password", pw),
    err,
    h("button", { class: "btn btn-navy", type: "submit" }, "Sign in"),
  );
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    err.replaceChildren();
    const user = new CognitoUser({ Username: (email as HTMLInputElement).value.trim().toLowerCase(), Pool: pool, Storage: sessionStore });
    const step = (title: string, label: string, type: string, submit: (v: string) => void) => {
      const input = h("input", { id: "step", type, autocomplete: type === "password" ? "new-password" : "one-time-code", required: true });
      const f = h("form", { class: "card stack", style: "max-width:420px" }, h("h2", {}, title), h("label", { for: "step" }, label, input), h("button", { class: "btn btn-navy", type: "submit" }, "Continue"));
      f.addEventListener("submit", (e2) => { e2.preventDefault(); submit((input as HTMLInputElement).value.trim()); });
      render(f);
      (input as HTMLInputElement).focus();
    };
    const cb = {
      onSuccess: () => void showQueue("APPLIED"),
      onFailure: (e: unknown) => showSignIn(authError(e)),
      mfaRequired: () => step("Enter your code", "6-digit code we texted you", "text", (c) => user.sendMFACode(c, cb)),
      totpRequired: () => step("Enter your code", "6-digit code from your authenticator app", "text", (c) => user.sendMFACode(c, cb, "SOFTWARE_TOKEN_MFA")),
      newPasswordRequired: () => step("Choose a new password", "New password (12+ characters)", "password", (p) => user.completeNewPasswordChallenge(p, {}, cb)),
    };
    user.authenticateUser(new AuthenticationDetails({ Username: (email as HTMLInputElement).value.trim().toLowerCase(), Password: (pw as HTMLInputElement).value }), cb);
  });
  render(form);
}

async function showQueue(status: string) {
  signoutBtn.hidden = false;
  const tabs = h("div", { class: "tabs", role: "group", "aria-label": "Filter by status" },
    ...STATUSES.map((s) => h("button", { type: "button", "aria-pressed": String(s === status), onclick: () => void showQueue(s) }, s.replace("_", " ").toLowerCase())));
  render(h("div", { class: "stack" }, h("h2", {}, "Physicians"), tabs, h("p", { class: "muted" }, "Loading…")));
  try {
    const { providers } = await api<{ providers: Provider[] }>("GET", `/staff/providers?status=${status}`);
    const body = providers.length === 0
      ? h("p", { class: "muted" }, "Nobody here right now.")
      : h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Physician"), h("th", {}, "NPI"), h("th", {}, "Licenses"), h("th", {}, "Applied"), h("th", {}, ""))),
          h("tbody", {}, ...providers.map((p) => h("tr", {},
            h("td", {}, `${p.fullName}, ${p.credentials}`, h("div", { class: "muted" }, p.specialty.replace(/_/g, " ").toLowerCase())),
            h("td", { class: "mono" }, p.npi),
            h("td", {}, ...p.licenses.map((l) => h("div", {}, h("span", { class: `pill ${l.verifiedAt ? "good" : "warn"}` }, l.state), " ", h("span", { class: "mono" }, l.number)))),
            h("td", { class: "muted" }, new Date(p.createdAt).toLocaleDateString()),
            h("td", {}, h("button", { class: "btn btn-ghost", type: "button", onclick: () => showProvider(p, status) }, "Open")),
          )))));
    render(h("div", { class: "stack" }, h("h2", {}, "Physicians"), tabs, body));
  } catch (e) {
    if ((e as Error).message !== "signed out") render(h("div", { class: "stack" }, h("h2", {}, "Physicians"), tabs, errorBox((e as Error).message)));
  }
}

function showProvider(p: Provider, fromStatus: string) {
  const msg = h("div");
  const act = async (label: string, fn: () => Promise<unknown>, after: () => void) => {
    msg.replaceChildren(h("p", { class: "muted" }, `${label}…`));
    try { await fn(); after(); } catch (e) { msg.replaceChildren(errorBox((e as Error).message)); }
  };
  const reasonInput = h("textarea", { id: "reason", rows: "2", placeholder: "Required for reject or suspend. Kept in the audit log." }) as HTMLTextAreaElement;
  const reason = () => reasonInput.value.trim();
  const refresh = async () => {
    const { providers } = await api<{ providers: Provider[] }>("GET", `/staff/providers?status=${p.status}`).catch(() => ({ providers: [] as Provider[] }));
    const fresh = providers.find((x) => x.providerId === p.providerId);
    if (fresh) showProvider(fresh, fromStatus);
    else void showQueue(fromStatus);
  };

  const licenseRows = p.licenses.map((l) => {
    const src = h("input", { id: `src-${l.state}`, placeholder: "Where you checked, e.g. CA DCA License Search" }) as HTMLInputElement;
    const exp = h("input", { id: `exp-${l.state}`, value: l.expiresOn, placeholder: "YYYY-MM-DD" }) as HTMLInputElement;
    return h("div", { class: "card" },
      h("div", { class: "row-wrap" }, h("strong", {}, l.state), h("span", { class: "mono" }, l.number), h("span", { class: `pill ${l.verifiedAt ? "good" : "warn"}` }, l.verifiedAt ? "VERIFIED" : "NOT VERIFIED")),
      l.verifiedAt ? h("p", { class: "muted" }, `Verified ${new Date(l.verifiedAt).toLocaleString()} via ${l.verificationSource ?? "—"}`) : null,
      BOARD_LOOKUP[l.state] ? h("p", {}, h("a", { href: BOARD_LOOKUP[l.state]!, target: "_blank", rel: "noopener" }, `Open ${l.state} medical board lookup`)) : null,
      h("label", { for: `exp-${l.state}` }, "Expiration date on the board record", exp),
      h("label", { for: `src-${l.state}` }, "Verification source", src),
      h("button", { class: "btn btn-navy", type: "button", onclick: () => act("Saving", () => api("POST", `/staff/providers/${p.providerId}/licenses/${l.state}/verify`, { source: src.value.trim(), expiresOn: exp.value.trim() }), refresh) }, `Mark ${l.state} license verified`),
    );
  });

  render(h("div", { class: "stack" },
    h("p", {}, h("button", { class: "btn btn-ghost", type: "button", onclick: () => void showQueue(fromStatus) }, "← Back to list")),
    h("div", { class: "card" },
      h("div", { class: "row-wrap" }, h("h2", { style: "margin:0" }, `${p.fullName}, ${p.credentials}`), h("span", { class: "pill" }, p.status)),
      h("p", { class: "muted" }, p.specialty.replace(/_/g, " ").toLowerCase(), " · applied ", new Date(p.createdAt).toLocaleString()),
      h("p", {}, "NPI ", h("span", { class: "mono" }, p.npi), " · ", h("a", { href: `https://npiregistry.cms.hhs.gov/provider-view/${encodeURIComponent(p.npi)}`, target: "_blank", rel: "noopener" }, "Check NPI registry")),
      h("p", {}, p.resumeUploaded
        ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => act("Opening resume", async () => { const { url } = await api<{ url: string }>("GET", `/staff/providers/${p.providerId}/resume`); window.open(url, "_blank", "noopener"); }, () => msg.replaceChildren()) }, "View resume (PDF)")
        : h("span", { class: "pill warn" }, "NO RESUME YET")),
    ),
    h("h3", {}, "Licenses"),
    ...licenseRows,
    h("div", { class: "card" },
      h("h3", {}, "Decision"),
      h("p", { class: "muted" }, "Approve needs at least one verified license and a resume. The physician gets an email and text right away."),
      h("label", { for: "reason" }, "Reason", reasonInput),
      h("div", { class: "row-wrap" },
        p.status === "APPLIED" ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => act("Starting review", () => api("POST", `/staff/providers/${p.providerId}/review`), () => void showQueue("UNDER_REVIEW")) }, "Start review") : null,
        p.status === "UNDER_REVIEW" ? h("button", { class: "btn btn-navy", type: "button", onclick: () => act("Approving", () => api("POST", `/staff/providers/${p.providerId}/approve`), () => void showQueue("APPROVED")) }, "Approve") : null,
        p.status === "APPLIED" || p.status === "UNDER_REVIEW" ? h("button", { class: "btn btn-danger", type: "button", onclick: () => reason() ? act("Rejecting", () => api("POST", `/staff/providers/${p.providerId}/reject`, { reason: reason() }), () => void showQueue("REJECTED")) : msg.replaceChildren(errorBox("Add a reason first.")) }, "Reject") : null,
        p.status === "APPROVED" || p.status === "ACTIVE" ? h("button", { class: "btn btn-danger", type: "button", onclick: () => reason() ? act("Suspending", () => api("POST", `/staff/providers/${p.providerId}/suspend`, { reason: reason() }), () => void showQueue("SUSPENDED")) : msg.replaceChildren(errorBox("Add a reason first.")) }, "Suspend") : null,
      ),
      msg,
    ),
  ));
}

async function start() {
  try {
    cfg = (await (await fetch("/config.json", { cache: "no-store" })).json()) as Config;
  } catch {
    render(errorBox("The portal isn't configured yet. Deploy the site first."));
    return;
  }
  pool = new CognitoUserPool({ UserPoolId: cfg.staffPoolId, ClientId: cfg.staffClientId, Storage: sessionStore });
  signoutBtn.onclick = () => {
    const u = pool.getCurrentUser();
    if (u) u.globalSignOut({ onSuccess: () => showSignIn("Signed out."), onFailure: () => { u.signOut(); showSignIn("Signed out."); } });
  };
  if (await idToken()) void showQueue("APPLIED");
  else showSignIn();
}
void start();
