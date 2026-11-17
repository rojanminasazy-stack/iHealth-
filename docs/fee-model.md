# Pricing

## Patients
| Plan | Price | Status |
|---|---|---|
| Pay per visit | $79 per 20-minute video visit | Built. Card held at booking, charged after the visit, paid to the physician's own Stripe account. No booking fee. |
| Unlimited membership | $99/month | On the website. **Not built yet**: waiting on a decision about how physicians are paid for member visits, and attorney review. |

## Physicians
| Plan | Price |
|---|---|
| Founding Physician (first 50) | 90 days free, then $99/month locked |
| Standard | $199/month |

## Open decision: paying physicians for member visits
Under the membership, iHealthé collects $99/month and physicians must be paid per visit by iHealthé.
That makes iHealthé the seller of care, which raises California corporate-practice-of-medicine and fee-splitting questions (B&P §650, §2400).
Common structures: a professional medical corporation (PC) owned by a physician that sells the membership, with iHealthé as its management company (MSO).
**A healthcare attorney must approve the structure before memberships are sold.**

## What Stripe may see
Name, email, amount, and a generic description: `iHealthé visit`. Never symptoms, history, medications or notes.
