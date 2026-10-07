# HIPAA program checklist

iHealthé is a **business associate** of every physician on the platform. Software is one part. Every box below must be checked before a real patient is seen.

## Legal and contracts
- [ ] Healthcare attorney reviews marketplace model, fee structure (B&P §650), terms of service, privacy policy
- [ ] AWS BAA accepted (AWS Artifact → Agreements)
- [ ] BAA template for physicians drafted by attorney; click-to-sign in onboarding
- [ ] BAA or confirmation of no PHI for every other vendor (see Vendor matrix)
- [ ] Trademark clearance for "iHealthé"

## People
- [ ] Privacy Officer named
- [ ] Security Officer named (can be the same person at first)
- [ ] Workforce HIPAA training before production access, then yearly
- [ ] Access termination procedure

## Risk
- [ ] Formal security risk analysis (HHS SRA tool is free)
- [ ] Risk register with owners
- [ ] Policies: access control, audit, incident response, breach notification, backup/DR, device use, retention, vendor management
- [ ] Incident response tabletop exercise

## Technical (built in this repo)
- [x] Encryption at rest with customer-managed KMS key, rotation on
- [x] TLS only; S3 denies non-TLS requests
- [x] MFA required for physicians and staff
- [x] Separate login pools for patients, physicians, staff
- [x] Append-only audit table + CloudTrail
- [x] Point-in-time recovery on all tables, versioned documents bucket
- [x] No PHI in notifications or in Stripe
- [ ] Malware scan on uploads (GuardDuty Malware Protection for S3)
- [ ] WAF in front of API
- [ ] Alerts on unusual access patterns
- [ ] Backup restore test performed and documented
- [ ] Independent penetration test, critical findings fixed

## Vendor matrix

| Vendor | Touches PHI? | BAA |
|---|---|---|
| AWS (Cognito, Lambda, DynamoDB, S3, SES, SMS, Chime, KMS) | Yes | AWS BAA |
| Stripe | No (by design) | Not required if no PHI sent |
| Amazon Chime SDK (video) | Yes (live audio/video, not recorded) | AWS BAA |
| GitHub | No (code only, never data) | Not required |
| Apple / Google push | No (generic text only) | Not required |
