# Fee model (hybrid)

## Decisions

- Physicians are independent. They set their own visit price and are paid directly by patients.
- iHealthé earns from two streams:
  1. **Patient booking fee** — flat per booking, paid by the patient for using the platform. Not a share of the physician's fee.
  2. **Physician subscription** — flat monthly fee for access to the platform. Does not change with visit volume.
- No percentage commission on medical fees. California Business & Professions Code §650 and fee-splitting rules make percentage-of-fee arrangements risky. **A healthcare attorney must approve the final structure before launch.**

## Default numbers (configurable in `backend/src/domain/fees.ts`)

| Item | Value |
|---|---|
| Patient booking fee | $9.00 |
| Physician subscription, standard | $199 / month |
| Founding Physician (first 50) | 90 days free, then $99 / month locked |
| Visit price range a physician may set | $25 – $300 |

## Payment flow (Stripe Connect, destination charges)

1. Physician onboards to Stripe Express during signup. Stripe verifies identity and bank.
2. Patient books. iHealthé creates one PaymentIntent:
   - `amount` = visit price + booking fee
   - `application_fee_amount` = booking fee
   - `transfer_data.destination` = physician's Stripe account
3. The card is authorized at booking and captured when the visit completes. A cancelled or no-match request releases the hold.
4. Subscriptions bill separately through Stripe Billing on the physician's own card.

## What Stripe may see

Name, email, amount, and a generic description: `iHealthé visit`. Never symptoms, specialty, diagnosis, or notes.
