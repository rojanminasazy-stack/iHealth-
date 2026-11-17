import { App } from "aws-cdk-lib";
import { IHealtheStack } from "../lib/ihealthe-stack.js";

/**
 * The backend only. The public website (ihealthe.net) is hosted free on GitHub Pages,
 * and the domain's DNS stays at GoDaddy.
 */
const app = new App();
const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
const domain = (app.node.tryGetContext("domain") as string) ?? "ihealthe.net";

new IHealtheStack(app, `ihealthe-${stage}`, {
  stage,
  domain,
  emailFrom: app.node.tryGetContext("emailFrom") as string,
  appUrl: app.node.tryGetContext("appUrl") as string,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-west-2" },
  tags: { project: "ihealthe", stage, "data-classification": "phi" },
});
