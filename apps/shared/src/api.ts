import type { Auth } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Quote {
  visitPriceCents: number;
  bookingFeeCents: number;
  totalCents: number;
  platformFeeCents: number;
  physicianReceivesCents: number;
}

export interface PhysicianCard {
  providerId: string;
  name: string;
  specialty: string;
  languages: string[];
  visitPriceCents: number;
  rating: number | null;
  verified: boolean;
  quote: Quote;
}

export interface CreatedRequest {
  requestId: string;
  status: string;
  quote: Quote;
  paymentClientSecret: string;
  physician: Omit<PhysicianCard, "quote">;
}

/** Chime SDK join payload, passed straight to the visit page. */
export interface JoinInfo {
  meeting: unknown;
  attendee: unknown;
}

export interface PhysicianVisit {
  requestId: string;
  status: "MATCHED" | "IN_VISIT";
  ageGroup: "ADULT" | "CHILD";
  specialty: string;
  patientState: string;
  chiefComplaint: string;
  symptomDuration: string;
  createdAt: string;
}

export interface RequestStatus {
  requestId: string;
  status: "REQUESTED" | "OFFERED" | "MATCHED" | "IN_VISIT" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "PROVIDER_CANCELLED";
  visitPriceCents: number;
  bookingFeeCents: number;
  physician: Omit<PhysicianCard, "quote"> | null;
  patientSummary: string | null;
  completedAt: string | null;
}

export interface PhysicianSelf {
  providerId: string;
  fullName: string;
  credentials: string;
  specialty: string;
  status: "APPLIED" | "UNDER_REVIEW" | "APPROVED" | "ACTIVE" | "REJECTED" | "SUSPENDED";
  online: boolean;
  visitPriceCents: number;
  licenses: { state: string; number: string; expiresOn: string; verified: boolean }[];
  baaSigned: boolean;
  payoutsReady: boolean;
  subscriptionStatus: string | null;
  subscriptionReady: boolean;
  plan: { priceCents: number; trialDays: number; label: string };
  resumeUploaded: boolean;
  founding: boolean;
  nextSteps: string[];
}

export interface OpenRequest {
  requestId: string;
  ageGroup: "ADULT" | "CHILD";
  specialty: string;
  patientState: string;
  chiefComplaint: string;
  symptomDuration: string;
  youReceiveCents: number;
  createdAt: string;
}

/** Thin, typed client. Sends the Cognito ID token; never sends prices or roles (the server decides those). */
export function createApi(baseUrl: string, auth: Auth) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await auth.idToken();
    if (!token) throw new ApiError(401, "Your session ended. Sign in again.");
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "Can't reach iHealthé. Check your connection.");
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong. Try again.");
    return data as T;
  }

  return {
    patient: {
      physicians: (q: { state: string; specialty: string; ageGroup: string; language?: string }) =>
        call<{ physicians: PhysicianCard[] }>("GET", `/patient/physicians?${new URLSearchParams(q as Record<string, string>)}`),
      createRequest: (b: {
        providerId: string;
        patientState: string;
        ageGroup: string;
        specialty: string;
        chiefComplaint: string;
        symptomDuration: string;
        emergencyAcknowledged: true;
      }) => call<CreatedRequest>("POST", "/patient/requests", b),
      request: (id: string) => call<RequestStatus>("GET", `/patient/requests/${encodeURIComponent(id)}`),
      cancel: (id: string) => call<{ status: string }>("POST", `/patient/requests/${encodeURIComponent(id)}/cancel`),
      join: (id: string) => call<JoinInfo>("POST", `/patient/requests/${encodeURIComponent(id)}/join`),
    },
    physician: {
      me: () => call<PhysicianSelf>("GET", "/physician/me"),
      apply: (b: {
        fullName: string;
        credentials: string;
        npi: string;
        specialty: string;
        languages: string[];
        licenses: { state: string; number: string; expiresOn: string }[];
        visitPriceCents: number;
        acceptsPediatric: boolean;
      }) => call<PhysicianSelf>("POST", "/physician/application", b),
      resumeUploadUrl: () => call<{ uploadUrl: string; contentType: string; maxBytes: number }>("POST", "/physician/resume-upload"),
      signBaa: (version: string) => call<PhysicianSelf>("POST", "/physician/baa", { accept: true, version }),
      payoutsLink: () => call<{ url: string }>("POST", "/physician/payouts"),
      setPrice: (visitPriceCents: number) => call<{ visitPriceCents: number; bookingFeeCents: number }>("PUT", "/physician/price", { visitPriceCents }),
      setOnline: (online: boolean) => call<{ online: boolean }>("POST", "/physician/online", { online }),
      openRequests: () => call<{ requests: OpenRequest[] }>("GET", "/physician/requests"),
      subscription: () => call<{ url: string }>("POST", "/physician/subscription"),
      visits: () => call<{ visits: PhysicianVisit[] }>("GET", "/physician/visits"),
      join: (id: string) => call<JoinInfo>("POST", `/physician/visits/${encodeURIComponent(id)}/join`),
      complete: (id: string, patientSummary: string) =>
        call<{ requestId: string; status: string }>("POST", `/physician/visits/${encodeURIComponent(id)}/complete`, { patientSummary }),
      accept: (id: string) => call<{ requestId: string; status: string }>("POST", `/physician/requests/${encodeURIComponent(id)}/accept`),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
