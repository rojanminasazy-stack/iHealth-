# Switching on the backend (AWS)

The website already runs free on GitHub Pages, and ihealthe.net stays at GoDaddy. This guide switches on the secure backend: accounts, confirmation codes, the welcome text, patient profiles, payments and video.

No coding. Every command runs in **AWS CloudShell**, a terminal inside the AWS website. You copy, paste and press Enter.

## Part 1: Create the AWS account (about 15 minutes)
1. Go to **https://portal.aws.amazon.com/billing/signup**
2. Email: an address you'll keep. Account name: `iHealthe LLC`.
3. Confirm the code AWS emails you, then create a strong root password.
4. Contact information: choose **Business**. Enter the LLC's legal name and address.
5. Add a payment card. AWS charges $1 to check it, then refunds it.
6. Confirm your phone number by text or call.
7. Support plan: **Basic support – Free**.

If you land on a page called **Projects** (AWS's new setup page), click **Create project**, name it `iHealthe`, finish the steps, then open the AWS console from it.

## Part 2: Lock the account (2 minutes)
1. In the search bar at the top of the AWS console, type **IAM** and open it.
2. You'll see "Add MFA for root user." Click **Add MFA** → **Authenticator app** → scan the code with Google Authenticator or your phone's password app → enter two codes in a row.

## Part 3: Accept the HIPAA agreement (BAA) (2 minutes)
1. In the search bar, type **Artifact** and open **AWS Artifact**.
2. Click **Agreements** → **Account agreements**.
3. Click **AWS Business Associate Addendum** → **Accept agreement**. Read it and accept.

## Part 4: Turn on the backend (about 20 minutes, mostly waiting)
1. Top right of the console, set the region to **US West (Oregon)**.
2. Click the **CloudShell** icon (a small `>_` square at the top). Wait for the black window to open.
3. Paste this whole block and press Enter:

```bash
git clone https://github.com/rojanminasazy-stack/iHealth-.git ihealthe && cd ihealthe
npm install -w backend -w infra --no-audit --no-fund
cd infra
npx cdk bootstrap
npx cdk deploy --require-approval never
```

4. Wait until you see **Outputs:** followed by a list. Copy everything from **Outputs** down and send it to me. Those are public addresses, not passwords.

## Part 5: Let AWS send email from ihealthe.net (GoDaddy, 5 minutes)
The outputs include three lines starting with `GoDaddyDkim`. For each one:
1. GoDaddy → **My Products** → ihealthe.net → **DNS** → **Add New Record**.
2. Type: **CNAME**. Name and Value: copy from that output line.
3. Save. Do not touch the existing website records.

## Part 6: Ask AWS to let you email everyone (1 minute + about a day)
1. Search **SES** → open **Amazon Simple Email Service** (Oregon).
2. Click **Get set up** → **Request production access**.
3. Mail type: **Transactional**. Website: `https://ihealthe.net`.
4. Use case (copy this): *iHealthé sends account verification codes, welcome messages and appointment confirmations to patients and physicians who sign up in our app. Messages contain no health information. We only email people who created an account.*

## Part 7: Text messages (1–3 weeks for approval)
1. Search **End User Messaging** → **SMS** → **Phone numbers** → **Request originator** → **Toll-free**, capability **SMS**.
2. Complete the registration. Use case: *Account notifications*. Sample message: `Welcome to iHealthé! Your account is ready. Reply STOP to opt out.`
3. Send me the number when it's approved.

## Part 8: Stripe (payments)
1. Sign up at **dashboard.stripe.com/register** with the LLC's details and bank account.
2. Turn on **Connect** → **Platform or marketplace** → **Express** accounts.
3. Stay in **Test mode** for now.
4. Send me the **publishable key** (`pk_test_...`). **Never send the secret key** (`sk_test_...`). It goes straight into AWS: Secrets Manager → open the secret named in the `StripeSecretName` output → **Retrieve secret value** → **Edit** → paste:

```json
{"secretKey":"sk_test_PASTE_HERE","webhookSecret":"whsec_PASTE_HERE"}
```

(The webhook secret comes from Stripe → Developers → Webhooks → Add endpoint, using the `StripeWebhookUrl` output. I'll walk you through that when you get there.)

## Never send in chat
AWS passwords, MFA codes, the Stripe secret key, the webhook secret, or any patient information.
