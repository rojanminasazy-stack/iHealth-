import { App } from "aws-cdk-lib";
import { IHealtheStack } from "../lib/ihealthe-stack.js";

const app = new App();
const stage = (app.node.tryGetContext("stage") as string) ?? "dev";

new IHealtheStack(app, `ihealthe-${stage}`, {
  stage,
  emailFrom: app.node.tryGetContext("emailFrom") as string,
  appUrl: app.node.tryGetContext("appUrl") as string,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-west-2" },
  tags: { project: "ihealthe", stage, "data-classification": "phi" },
});
