# Launch setup: AWS, domain, Stripe

Do these in order. You don't need to install anything on your computer. Every command runs in **AWS CloudShell**, a terminal inside the AWS website.

Rough cost while testing: $30–80/month (Route 53 $0.50, KMS key $1, Cognito Plus, Lambda/DynamoDB/CloudFront mostly free tier). Video is about $0.0017 per person-minute.

---

## 1. Create the AWS account

1. Go to **aws.amazon.com** and choose **Create an AWS Account**. Use a company email like `aws@ihealthe.net` once email works, or your own for now.
2. Account name: `iHealthe LLC`. Choose **Business** and enter the LLC's details and EIN.
3. Add a payment card.
4. Sign in as the root user. Open **IAM → Dashboard** and **add MFA to the root user** (an authenticator app). Do this before anything else.

## 2. Accept the AWS BAA

1. In the AWS console search bar, type **Artifact** and open **AWS Artifact**.
2. Choose **Agreements → Account agreements**.
3. Find **AWS Business Associate Addendum**, choose **Accept agreement**, and follow the prompts.
4. Download a copy for your records (HIPAA requires keeping it 6 years).

## 3. Create your everyday admin login

Don't use the root user day to day.

1. Open **IAM Identity Center** and choose **Enable**. Choose region **US West (Oregon) us-west-2** if it asks.
2. **Users → Add user**: your name and email. Turn on MFA when you first sign in.
3. **Permission sets → Create → Predefined → AdministratorAccess**.
4. **AWS accounts →** select your account → **Assign users** → you → AdministratorAccess.
5. Sign out of root. From now on, sign in through the Identity Center link it emails you.

## 4. Deploy, part 1: the domain

1. In the AWS console, set the region (top right) to **US West (Oregon)**.
2. Open **CloudShell** (the `>_` icon in the top bar). Paste:

```bash
git clone https://github.com/rojanminasazy-stack/iHealth-.git ihealthe && cd ihealthe
npm install -w backend -w infra -w website   # skips the phone apps to fit CloudShell storage
npm run build -w website
cd infra
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-west-2 aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1
npx cdk deploy ihealthe-dev-dns --require-approval never &
sleep 90; aws route53 list-hosted-zones-by-name --dns-name ihealthe.net --query "HostedZones[0].Id" --output text | xargs -I{} aws route53 get-hosted-zone --id {} --query "DelegationSet.NameServers" --output text
```

3. The last line prints **four nameservers** like `ns-123.awsdns-45.com`. Copy them.
4. Leave CloudShell open. The deploy keeps running and waits for step 5.

## 5. Point ihealthe.net at AWS (GoDaddy)

1. Sign in to GoDaddy → **My Products → ihealthe.net → DNS → Nameservers → Change nameservers**.
2. Choose **I'll use my own nameservers** and paste the four from step 4.
3. Save. GoDaddy may ask you to confirm. The switch usually takes 15 minutes to a few hours.
4. Back in CloudShell, the domain deploy finishes on its own once AWS sees the change.

> After this, DNS for ihealthe.net is managed in AWS Route 53. If you use GoDaddy email, tell me first so I can add its records to Route 53 before you switch.

## 6. Create the Stripe account

1. Go to **dashboard.stripe.com/register**. Use the LLC's legal name, EIN and business bank account.
2. Business type: **Healthcare → Telemedicine / medical services**. Website: `https://ihealthe.net`.
3. Turn on **Connect** (Settings → Connect → Get started). Choose **Platform or marketplace** and **Express** accounts.
4. Stay in **Test mode** (toggle at top) until launch.

**Keep your secret key private.** It starts with `sk_test_` and can move money. Don't paste it into chat, email or a document. It goes into AWS in step 8.

Send me the **publishable key** (`pk_test_...`) when you have it. That one is safe to share; it goes in the patient app.

## 7. Deploy, part 2: the backend and website

In CloudShell (still inside `ihealthe/infra`):

```bash
npx cdk deploy ihealthe-dev --require-approval never
```

This takes 10–20 minutes. At the end it prints **Outputs**. Copy them all into a note and send them to me. They're public identifiers, not secrets.

## 8. Put your Stripe keys into AWS

1. In Stripe (test mode): **Developers → Webhooks → Add endpoint**.
   - Endpoint URL: the `StripeWebhookUrl` from step 7's outputs.
   - Events: `account.updated`, `payment_intent.amount_capturable_updated`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   - Turn on **Listen to events on Connected accounts** as well.
   - Save, then reveal the **Signing secret** (`whsec_...`).
2. In AWS: **Secrets Manager →** open the secret named in `StripeSecretName` → **Retrieve secret value → Edit → Plaintext**, and paste:

```json
{"secretKey":"sk_test_PASTE_HERE","webhookSecret":"whsec_PASTE_HERE"}
```

3. Save. That's it; the backend reads it automatically.

## 9. Turn on real email sending

New AWS accounts can only email verified addresses ("sandbox").

1. Open **Amazon SES** (us-west-2) → **Get set up → Request production access**.
2. Mail type: **Transactional**. Website: `https://ihealthe.net`.
3. Use case (copy this): *"iHealthé sends account verification codes and appointment confirmations to patients and physicians who sign up in our app. Messages contain no health information. We handle bounces and complaints and only email users who created an account."*
4. Approval usually takes about a day.

## 10. Text messages (SMS)

Sign-in codes are texted by Cognito. Visit confirmations need your own number.

1. Open **AWS End User Messaging SMS** (us-west-2) → **Phone numbers → Request** → **Toll-free**, capability **SMS**.
2. Complete **toll-free registration** with the LLC details. Use case: *Account notifications*. Sample message: `Your iHealthé visit is confirmed. Open the app to join when you're ready. Reply STOP to opt out.`
3. Registration takes 1–3 weeks. Send me the number once it's active.
4. Also request a spending limit increase (**Account settings → Spend limits**). The default is $1/month.

## 11. Create your first staff login (credentialing)

In CloudShell:

```bash
POOL=$(aws cloudformation describe-stacks --stack-name ihealthe-dev --query "Stacks[0].Outputs[?OutputKey=='StaffPoolId'].OutputValue" --output text)
aws cognito-idp admin-create-user --user-pool-id $POOL --username you@ihealthe.net \
  --user-attributes Name=email,Value=you@ihealthe.net Name=email_verified,Value=true Name=phone_number,Value=+1XXXXXXXXXX Name=phone_number_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username you@ihealthe.net --group-name credentialing
```

You'll get an email with a temporary password. Sign in at **https://ihealthe.net/staff/**. It asks you to set a new password, then texts you a code each time.

## 12. App stores

- **Apple:** developer.apple.com/programs/enroll → **Organization**. You need a free D-U-N-S number for the LLC first (Apple links to the lookup). $99/year. Takes 1–2 weeks.
- **Google:** play.google.com/console → **Organization** account. $25 one-time. Google requires 12+ testers for 14 days before a new organization's first public release, so start recruiting testers early.

---

## What to send me

- [ ] Stripe publishable key (`pk_test_...`)
- [ ] The outputs from step 7
- [ ] Your toll-free number when it's approved
- [ ] Apple Team ID and Google Play developer account email when those are ready

Never send: AWS passwords, the Stripe secret key, webhook signing secret, or any patient information.
