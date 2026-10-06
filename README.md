# iHealthé

On-demand physician marketplace. Think Uber, for doctors.

- **Patients** open the app, say what's going on and where they are, pick a licensed physician in their state, pay, and join a video visit.
- **Physicians** apply with their resume and license, get verified by iHealthé, go online, and accept patients.
- **iHealthé** connects them. It does not employ physicians or make medical decisions.

## How money moves (hybrid model)

| Who pays | What | Goes to |
|---|---|---|
| Patient | Physician's visit price (set by the physician) | Physician's own Stripe account |
| Patient | Booking fee (flat, e.g. $9) | iHealthé |
| Physician | Monthly subscription (e.g. $199; founding doctors get 90 days free, then $99 locked) | iHealthé |

Payments run on **Stripe Connect**. The patient pays once; Stripe routes the visit price to the physician and the booking fee to iHealthé. No medical information is ever sent to Stripe. See [docs/fee-model.md](docs/fee-model.md).

## Repository layout

```
backend/   Business logic + AWS Lambda handlers (TypeScript)
infra/     AWS infrastructure as code (CDK)
docs/      Architecture, HIPAA program checklist, fee model
apps/      (next) Patient app + Physician app — React Native / Expo
```

## Stack (all HIPAA-eligible under the AWS BAA)

- Login + MFA: Amazon Cognito (separate pools for patients, physicians, staff)
- API: API Gateway + Lambda
- Database: DynamoDB, encrypted with a customer-managed KMS key
- Files (resumes, license documents): S3, encrypted, private, versioned
- Email: Amazon SES · Text messages: AWS End User Messaging SMS
- Video: Amazon Chime SDK (not recorded)
- Audit: CloudTrail + an append-only application audit table

## Before any real patient uses this

Code alone does not make iHealthé HIPAA compliant. Work through [docs/hipaa-program.md](docs/hipaa-program.md) first. Every box there must be checked.

## Development

```bash
npm install
npm test          # unit tests for eligibility, matching, fees, onboarding
npm run typecheck
npm run synth     # renders the AWS CloudFormation template (no deploy)
```

Use fake data only in development. Never copy real patient data to a laptop.
