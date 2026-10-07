import { App } from "aws-cdk-lib";
import { IHealtheStack } from "../lib/ihealthe-stack.js";
import { DnsStack } from "../lib/dns-stack.js";

const app = new App();
const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
const domain = (app.node.tryGetContext("domain") as string) ?? "ihealthe.net";
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? "us-west-2";
const tags = { project: "ihealthe", stage, "data-classification": "phi" };

// Domain + certificate (us-east-1, required by CloudFront).
const dns = new DnsStack(app, `ihealthe-${stage}-dns`, {
  domain,
  env: { account, region: "us-east-1" },
  crossRegionReferences: true,
  tags,
});

new IHealtheStack(app, `ihealthe-${stage}`, {
  stage,
  domain,
  zone: dns.zone,
  certificate: dns.certificate,
  emailFrom: app.node.tryGetContext("emailFrom") as string,
  appUrl: app.node.tryGetContext("appUrl") as string,
  env: { account, region },
  crossRegionReferences: true,
  tags,
});
