/** US state, two-letter code. V1 launches in California; others are added as physicians join. */
export type StateCode = "CA" | "TX" | "NY" | "FL" | "AZ" | "NV" | "OR" | "WA";
export const STATES: readonly StateCode[] = ["CA", "TX", "NY", "FL", "AZ", "NV", "OR", "WA"];

export type Specialty =
  | "FAMILY_MEDICINE"
  | "INTERNAL_MEDICINE"
  | "EMERGENCY_MEDICINE"
  | "PEDIATRICS"
  | "PSYCHIATRY"
  | "DERMATOLOGY";

export type ProviderStatus = "APPLIED" | "UNDER_REVIEW" | "APPROVED" | "ACTIVE" | "REJECTED" | "SUSPENDED";

export interface License {
  state: StateCode;
  number: string;
  /** ISO date YYYY-MM-DD */
  expiresOn: string;
  /** Set only by staff after checking the state medical board. */
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface Provider {
  providerId: string;
  /** Cognito user id of the physician. */
  userId: string;
  fullName: string;
  credentials: string; // e.g. "MD", "DO"
  npi: string;
  specialty: Specialty;
  languages: string[];
  licenses: License[];
  status: ProviderStatus;
  /** Visit price in cents, set by the physician within platform limits. */
  visitPriceCents: number;
  online: boolean;
  acceptsPediatric: boolean;
  baaSignedAt?: string;
  stripeAccountId?: string;
  stripeChargesEnabled: boolean;
  resumeKey?: string;
  founding: boolean;
  /** Stripe Billing customer for the physician's iHealthé subscription (separate from the payout account). */
  stripeCustomerId?: string;
  /** Mirrors Stripe subscription status: trialing, active, past_due, canceled, ... */
  subscriptionStatus?: string;
  /** From the verified sign-in token. Used only for platform notices. */
  contact: { email?: string; phone?: string };
  createdAt: string;
  updatedAt: string;
  /** Simple rolling stats for ranking. */
  rating?: number;
  avgResponseSeconds?: number;
}

export type CareRequestStatus =
  | "REQUESTED"
  | "OFFERED"
  | "MATCHED"
  | "IN_VISIT"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "PROVIDER_CANCELLED";

export type AgeGroup = "ADULT" | "CHILD";

export interface CareRequest {
  requestId: string;
  patientUserId: string;
  /** Where the patient is physically located right now (patient attestation). */
  patientState: StateCode;
  ageGroup: AgeGroup;
  specialty: Specialty;
  chiefComplaint: string;
  symptomDuration: string;
  /** The physician the patient chose. */
  requestedProviderId: string;
  /** Present only while the request is paid-for and waiting for the physician; drives the openByState index. */
  openState?: StateCode;
  /** Where to send generic confirmations. Never included in notifications themselves. */
  patientContact: { email?: string; phone?: string };
  matchedProviderId?: string;
  status: CareRequestStatus;
  visitPriceCents?: number;
  bookingFeeCents?: number;
  paymentIntentId?: string;
  /** Amazon Chime SDK meeting for the video visit. Deleted when the visit ends. */
  meetingId?: string;
  startedAt?: string;
  completedAt?: string;
  /** Plain-language summary the physician writes for the patient at the end of the visit. */
  patientSummary?: string;
  /** Opaque index key "<providerId>" while matched/in visit, for the physician's visit list. */
  activeProviderId?: string;
  createdAt: string;
  updatedAt: string;
  /** Epoch seconds; DynamoDB TTL removes stale unmatched requests. */
  expiresAt: number;
}

export type AuditAction =
  | "PROVIDER_APPLIED"
  | "PROVIDER_REVIEW_STARTED"
  | "PROVIDER_LICENSE_VERIFIED"
  | "PROVIDER_APPROVED"
  | "PROVIDER_ACTIVATED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_SUSPENDED"
  | "PROVIDER_BAA_SIGNED"
  | "PROVIDER_ONLINE"
  | "PROVIDER_OFFLINE"
  | "CARE_REQUEST_CREATED"
  | "CARE_REQUEST_CANCELLED"
  | "CARE_REQUEST_ACCEPTED"
  | "CARE_REQUEST_ACCEPT_REJECTED"
  | "VISIT_STARTED"
  | "VISIT_JOINED"
  | "VISIT_COMPLETED"
  | "PAYMENT_AUTHORIZED"
  | "PAYMENT_CAPTURED"
  | "PAYMENT_RELEASED"
  | "SUBSCRIPTION_UPDATED"
  | "PROVIDER_LIST_VIEWED"
  | "INTAKE_VIEWED";

export type ActorRole = "PATIENT" | "PHYSICIAN" | "STAFF" | "SYSTEM";

export interface AuditEvent {
  eventId: string;
  at: string;
  actorId: string;
  actorRole: ActorRole;
  action: AuditAction;
  /** Opaque ids only. Never names, symptoms or other PHI. */
  resourceType: "PROVIDER" | "CARE_REQUEST" | "PAYMENT";
  resourceId: string;
  result: "ALLOWED" | "DENIED";
  reason?: string;
}
