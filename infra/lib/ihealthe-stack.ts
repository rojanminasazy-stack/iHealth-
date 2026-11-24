import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as ses from "aws-cdk-lib/aws-ses";

const here = path.dirname(fileURLToPath(import.meta.url));
const HANDLERS = path.join(here, "../../backend/src/handlers");

export interface IHealtheProps extends StackProps {
  stage: string;
  emailFrom: string;
  appUrl: string;
  domain: string;
}

/**
 * Everything here is on the AWS HIPAA-eligible services list and covered by the AWS BAA.
 * Accept the BAA in AWS Artifact BEFORE deploying to an account that will hold real data.
 */
export class IHealtheStack extends Stack {
  constructor(scope: Construct, id: string, props: IHealtheProps) {
    super(scope, id, props);
    const prod = props.stage === "prod";
    const retain = prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // ── Encryption: one customer-managed key for all PHI, rotated yearly ──
    const key = new kms.Key(this, "PhiKey", {
      alias: `alias/ihealthe-${props.stage}-phi`,
      enableKeyRotation: true,
      description: "Encrypts iHealthé PHI at rest",
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // CloudWatch Logs encrypts our log groups with this key, so it must be allowed to use it (for this account's logs only).
    key.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
        actions: ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"],
        resources: ["*"],
        conditions: { ArnLike: { "kms:EncryptionContext:aws:logs:arn": `arn:aws:logs:${this.region}:${this.account}:log-group:*` } },
      }),
    );

    // ── Data ──
    const tableDefaults = {
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      encryption: ddb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: prod,
      removalPolicy: retain,
    };

    const providers = new ddb.Table(this, "Providers", {
      ...tableDefaults,
      partitionKey: { name: "providerId", type: ddb.AttributeType.STRING },
    });
    providers.addGlobalSecondaryIndex({ indexName: "byUser", partitionKey: { name: "userId", type: ddb.AttributeType.STRING } });
    providers.addGlobalSecondaryIndex({ indexName: "byStatus", partitionKey: { name: "status", type: ddb.AttributeType.STRING } });
    providers.addGlobalSecondaryIndex({
      indexName: "byStripeAccount",
      partitionKey: { name: "stripeAccountId", type: ddb.AttributeType.STRING },
      projectionType: ddb.ProjectionType.KEYS_ONLY,
    });

    const requests = new ddb.Table(this, "CareRequests", {
      ...tableDefaults,
      partitionKey: { name: "requestId", type: ddb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
    });
    // Sparse index: only paid-for, waiting requests carry openState.
    requests.addGlobalSecondaryIndex({
      indexName: "openByState",
      partitionKey: { name: "openState", type: ddb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: ddb.AttributeType.STRING },
    });
    // Sparse index: only matched / in-visit requests carry activeProviderId.
    requests.addGlobalSecondaryIndex({
      indexName: "byActiveProvider",
      partitionKey: { name: "activeProviderId", type: ddb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: ddb.AttributeType.STRING },
    });
    requests.addGlobalSecondaryIndex({
      indexName: "byPatient",
      partitionKey: { name: "patientUserId", type: ddb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: ddb.AttributeType.STRING },
    });

    const auditTable = new ddb.Table(this, "Audit", {
      ...tableDefaults,
      partitionKey: { name: "pk", type: ddb.AttributeType.STRING },
      sortKey: { name: "sk", type: ddb.AttributeType.STRING },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Patient "About you" answers (PHI). Encrypted with the PHI key, point-in-time recovery on.
    const patientsTable = new ddb.Table(this, "PatientProfiles", {
      ...tableDefaults,
      partitionKey: { name: "userId", type: ddb.AttributeType.STRING },
    });

    const counters = new ddb.Table(this, "Counters", {
      ...tableDefaults,
      partitionKey: { name: "name", type: ddb.AttributeType.STRING },
    });

    // ── Documents (resumes, license copies): private, encrypted, versioned, TLS-only ──
    const accessLogs = new s3.Bucket(this, "AccessLogs", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: Duration.days(2190) }], // 6 years
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const documents = new s3.Bucket(this, "Documents", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: "documents/",
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [props.appUrl], allowedHeaders: ["*"], maxAge: 300 }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ── Sign-in: three separate pools so a patient token can never call staff routes ──
    const pool = (name: string, opts: { mfa: cognito.Mfa; selfSignUp: boolean }) => {
      const p = new cognito.UserPool(this, name, {
        userPoolName: `ihealthe-${props.stage}-${name.toLowerCase()}`,
        selfSignUpEnabled: opts.selfSignUp,
        signInAliases: { email: true },
        autoVerify: { email: true, phone: true },
        standardAttributes: {
          email: { required: true, mutable: true },
          phoneNumber: { required: true, mutable: true },
        },
        mfa: opts.mfa,
        mfaSecondFactor: { sms: true, otp: true },
        passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: false, tempPasswordValidity: Duration.days(3) },
        accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
        featurePlan: cognito.FeaturePlan.PLUS, // threat protection: compromised-credential + adaptive auth
        deletionProtection: prod,
        removalPolicy: retain,
      });
      const client = p.addClient(`${name}App`, {
        authFlows: { userSrp: true },
        preventUserExistenceErrors: true,
        accessTokenValidity: Duration.minutes(30),
        idTokenValidity: Duration.minutes(30),
        refreshTokenValidity: Duration.days(prod ? 7 : 30),
        enableTokenRevocation: true,
      });
      return { pool: p, client };
    };
    const patients = pool("Patients", { mfa: cognito.Mfa.OPTIONAL, selfSignUp: true });
    const physicians = pool("Physicians", { mfa: cognito.Mfa.REQUIRED, selfSignUp: true });
    const staff = pool("Staff", { mfa: cognito.Mfa.REQUIRED, selfSignUp: false });
    new cognito.CfnUserPoolGroup(this, "CredentialingGroup", {
      userPoolId: staff.pool.userPoolId,
      groupName: "credentialing",
      description: "Can review, verify, approve and suspend physicians",
    });

    // ── Secrets (set values after deploy; never in code) ──
    const stripeSecret = new secrets.Secret(this, "StripeSecret", {
      description: "Stripe secret key and webhook signing secret: {\"secretKey\":\"sk_...\",\"webhookSecret\":\"whsec_...\"}",
      encryptionKey: key,
    });

    // ── Lambdas ──
    const env = {
      PROVIDERS_TABLE: providers.tableName,
      REQUESTS_TABLE: requests.tableName,
      AUDIT_TABLE: auditTable.tableName,
      PATIENTS_TABLE: patientsTable.tableName,
      COUNTERS_TABLE: counters.tableName,
      DOCUMENTS_BUCKET: documents.bucketName,
      KMS_KEY_ARN: key.keyArn,
      EMAIL_FROM: props.emailFrom,
      APP_URL: props.appUrl,
      // Lambdas read the Stripe keys from Secrets Manager at runtime; only the secret's ARN is here.
      STRIPE_SECRET_ARN: stripeSecret.secretArn,
      SMS_ORIGINATION: "",
      VIDEO_MEDIA_REGION: this.region, // set once a toll-free number is registered in AWS End User Messaging
      NODE_OPTIONS: "--enable-source-maps",
      ASSISTANT_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    };

    const fns: lambda.Function[] = [];
    const fn = (file: string, exportName: string) => {
      const f = new nodejs.NodejsFunction(this, `${file}-${exportName}`, {
        entry: path.join(HANDLERS, `${file}.ts`),
        handler: exportName,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout: Duration.seconds(file === "assistant" ? 29 : 15),
        environment: env,
        environmentEncryption: key,
        bundling: {
          format: nodejs.OutputFormat.ESM,
          minify: true,
          sourceMap: true,
          mainFields: ["module", "main"],
          // Lets CommonJS deps (e.g. Stripe) use require() inside the ESM bundle.
          banner: "import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
        },
        logGroup: new logs.LogGroup(this, `${file}-${exportName}-logs`, {
          retention: logs.RetentionDays.SIX_YEARS,
          encryptionKey: key,
          removalPolicy: retain,
        }),
      });
      providers.grantReadWriteData(f);
      requests.grantReadWriteData(f);
      counters.grantReadWriteData(f);
      patientsTable.grantReadWriteData(f);
      // Audit is append-only: PutItem, nothing else.
      f.addToRolePolicy(new iam.PolicyStatement({ actions: ["dynamodb:PutItem"], resources: [auditTable.tableArn] }));
      key.grantEncryptDecrypt(f);
      stripeSecret.grantRead(f);
      f.addToRolePolicy(new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }));
      f.addToRolePolicy(new iam.PolicyStatement({ actions: ["sms-voice:SendTextMessage"], resources: ["*"] }));
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["chime:CreateMeeting", "chime:GetMeeting", "chime:DeleteMeeting", "chime:CreateAttendee"],
          resources: ["*"],
        }),
      );
      if (file === "account") {
        f.addEnvironment("PATIENT_POOL_ID", patients.pool.userPoolId);
        f.addToRolePolicy(new iam.PolicyStatement({ actions: ["cognito-idp:AdminDeleteUser"], resources: [patients.pool.userPoolArn] }));
      }
      if (file === "assistant") {
        // Claude on Bedrock. The "us." inference profile can route to any US region, so allow those.
        f.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["bedrock:InvokeModel"],
            resources: [
              `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.*`,
              "arn:aws:bedrock:us-*::foundation-model/anthropic.*",
            ],
          }),
        );
      }
      fns.push(f);
      return f;
    };

    // ── API ──
    const api = new apigw.HttpApi(this, "Api", {
      apiName: `ihealthe-${props.stage}`,
      corsPreflight: {
        allowOrigins: [props.appUrl, `https://www.${props.domain}`],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT],
        allowHeaders: ["authorization", "content-type"],
        maxAge: Duration.hours(1),
      },
    });
    const stageDefault = api.defaultStage?.node.defaultChild as apigw.CfnStage;
    stageDefault.defaultRouteSettings = { throttlingBurstLimit: 50, throttlingRateLimit: 25 };

    const jwt = (name: string, p: { pool: cognito.UserPool; client: cognito.UserPoolClient }) =>
      new authorizers.HttpUserPoolAuthorizer(name, p.pool, { userPoolClients: [p.client] });
    const authPatient = jwt("PatientAuth", patients);
    const authPhysician = jwt("PhysicianAuth", physicians);
    const authStaff = jwt("StaffAuth", staff);

    const route = (
      method: apigw.HttpMethod,
      p: string,
      auth: apigw.IHttpRouteAuthorizer | undefined,
      file: string,
      exportName: string,
    ) =>
      api.addRoutes({
        path: p,
        methods: [method],
        authorizer: auth,
        integration: new integrations.HttpLambdaIntegration(`${file}-${exportName}-int`, fn(file, exportName)),
      });

    const { GET, POST, PUT } = apigw.HttpMethod;
    // Patients
    route(GET, "/patient/profile", authPatient, "profile", "get");
    route(PUT, "/patient/profile", authPatient, "profile", "put");
    route(GET, "/patient/consents", authPatient, "profile", "consentText");
    route(POST, "/patient/consents", authPatient, "profile", "consent");
    route(POST, "/patient/account/delete", authPatient, "account", "deleteAccount");
    route(GET, "/patient/physicians", authPatient, "patient", "listPhysicians");
    route(POST, "/patient/assistant", authPatient, "assistant", "ask");
    route(POST, "/patient/requests", authPatient, "patient", "createRequest");
    route(GET, "/patient/requests/{id}", authPatient, "patient", "getRequest");
    route(POST, "/patient/requests/{id}/join", authPatient, "visit", "patientJoin");
    route(POST, "/patient/requests/{id}/cancel", authPatient, "patient", "cancelRequest");
    // Physicians
    route(POST, "/physician/application", authPhysician, "physician", "apply");
    route(GET, "/physician/me", authPhysician, "physician", "me");
    route(POST, "/physician/resume-upload", authPhysician, "physician", "resumeUploadUrl");
    route(POST, "/physician/baa", authPhysician, "physician", "signBaa");
    route(POST, "/physician/payouts", authPhysician, "physician", "payoutsLink");
    route(POST, "/physician/online", authPhysician, "physician", "setOnline");
    route(GET, "/physician/requests", authPhysician, "physician", "openRequests");
    route(POST, "/physician/requests/{id}/accept", authPhysician, "physician", "accept");
    route(POST, "/physician/requests/{id}/decline", authPhysician, "physician", "decline");
    route(POST, "/physician/subscription", authPhysician, "physician", "subscription");
    route(GET, "/physician/visits", authPhysician, "visit", "physicianVisits");
    route(POST, "/physician/visits/{id}/join", authPhysician, "visit", "physicianJoin");
    route(POST, "/physician/visits/{id}/complete", authPhysician, "visit", "complete");
    // Credentialing staff
    route(GET, "/staff/providers", authStaff, "staff", "queue");
    route(GET, "/staff/providers/{id}/resume", authStaff, "staff", "resume");
    route(POST, "/staff/providers/{id}/review", authStaff, "staff", "startReview");
    route(POST, "/staff/providers/{id}/licenses/{state}/verify", authStaff, "staff", "verifyLicense");
    route(POST, "/staff/providers/{id}/approve", authStaff, "staff", "approve");
    route(POST, "/staff/providers/{id}/reject", authStaff, "staff", "reject");
    route(POST, "/staff/providers/{id}/suspend", authStaff, "staff", "suspend");
    // Stripe (signature-verified inside the handler)
    route(POST, "/webhooks/stripe", undefined, "stripeWebhook", "main");

    // Welcome email + text when a patient confirms their account.
    patients.pool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, fn("welcome", "main"));

    // Upload/view links need S3 access for the physician + staff handlers.
    for (const f of fns) documents.grantReadWrite(f);

    // ── Account-level audit trail ──
    const trailBucket = new s3.Bucket(this, "TrailLogs", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: Duration.days(2190) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    key.grantEncryptDecrypt(new iam.ServicePrincipal("cloudtrail.amazonaws.com"));
    const trail = new cloudtrail.Trail(this, "Trail", {
      bucket: trailBucket,
      encryptionKey: key,
      enableFileValidation: true,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
    });
    trail.addS3EventSelector([{ bucket: documents }], { readWriteType: cloudtrail.ReadWriteType.ALL });

    // ── Email: verify ihealthe.net in SES. DNS stays at GoDaddy (the website runs on GitHub Pages),
    //    so the three DKIM records are printed as outputs to add in GoDaddy by hand. ──
    const emailDomain = new ses.EmailIdentity(this, "EmailDomain", {
      identity: ses.Identity.domain(props.domain),
    });
    emailDomain.dkimRecords.forEach((r, i) => {
      new CfnOutput(this, `GoDaddyDkim${i + 1}`, {
        value: `CNAME  name: ${r.name.replace(`.${props.domain}`, "")}  value: ${r.value}`,
        description: "Add this CNAME record in GoDaddy DNS so iHealthé can send email",
      });
    });

    // ── Outputs the apps need ──
    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "PatientPoolId", { value: patients.pool.userPoolId });
    new CfnOutput(this, "PatientClientId", { value: patients.client.userPoolClientId });
    new CfnOutput(this, "PhysicianPoolId", { value: physicians.pool.userPoolId });
    new CfnOutput(this, "PhysicianClientId", { value: physicians.client.userPoolClientId });
    new CfnOutput(this, "StaffPoolId", { value: staff.pool.userPoolId });
    new CfnOutput(this, "StaffClientId", { value: staff.client.userPoolClientId });
    new CfnOutput(this, "StripeSecretName", { value: stripeSecret.secretName });
    new CfnOutput(this, "StripeWebhookUrl", { value: `${api.apiEndpoint}/webhooks/stripe` });
  }
}
