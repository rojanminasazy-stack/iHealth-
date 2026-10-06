# Architecture

```
 Patient app ──┐                         ┌── Physician app
               ▼                         ▼
           API Gateway (TLS, throttling, Cognito authorizers)
                         │
              Lambda handlers (backend/src/handlers)
                         │
  ┌──────────────┬───────┴──────┬──────────────┬─────────────┐
  │ Providers    │ CareRequests │ Audit        │ Documents   │
  │ (DynamoDB)   │ (DynamoDB)   │ (DynamoDB,   │ (S3, KMS)   │
  │              │              │ append-only) │             │
  └──────────────┴──────────────┴──────────────┴─────────────┘
        all encrypted with one customer-managed KMS key
                         │
        SES email · SMS · Chime video · Stripe Connect
```

## Core rules

1. **Eligibility before ranking.** A physician is only shown to a patient if they are approved, online, accepting patients, have a signed BAA, an active Stripe account, and an unexpired license in the state where the patient is *physically located right now*. Ranking can never override eligibility. (`backend/src/domain/eligibility.ts`)
2. **The patient chooses.** Patients see the eligible list and pick a physician, or tap "First available".
3. **Server decides everything sensitive.** Price, fees, eligibility, roles and state transitions are computed on the server. The app's claims are never trusted.
4. **Atomic accept.** Two physicians cannot accept the same request. DynamoDB conditional writes enforce it.
5. **Minimum necessary.** Before accepting, a physician sees age group, visit type and chief complaint only. Full intake unlocks after the match.
6. **No PHI in notifications.** Emails and texts say "Your iHealthé visit is confirmed. Open the app for details." Never symptoms or names of conditions.
7. **Audit everything.** Every application, approval, request, view, accept and payment writes an audit event that application code can't update or delete.

## Physician onboarding state machine

```
APPLIED → UNDER_REVIEW → APPROVED → ACTIVE
                      ↘ REJECTED
ACTIVE → SUSPENDED (license expired, complaint, or manual)
```

ACTIVE requires: license verified by staff, BAA signed, Stripe account ready.

## Care request state machine

```
REQUESTED → OFFERED → MATCHED → IN_VISIT → COMPLETED
     ↘ CANCELLED   ↘ EXPIRED    ↘ PROVIDER_CANCELLED
```
