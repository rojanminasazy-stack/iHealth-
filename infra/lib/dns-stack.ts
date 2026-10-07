import { CfnOutput, Fn, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export interface DnsProps extends StackProps {
  domain: string;
}

/**
 * Lives in us-east-1 because CloudFront only accepts certificates from there.
 * Creates the Route 53 zone for the domain. After the first deploy, copy the four
 * NameServers outputs into GoDaddy (Domain → DNS → Nameservers → "I'll use my own").
 * The certificate validates itself automatically once the nameservers switch.
 */
export class DnsStack extends Stack {
  readonly zone: route53.IHostedZone;
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: DnsProps) {
    super(scope, id, props);
    const zone = new route53.PublicHostedZone(this, "Zone", { zoneName: props.domain });
    this.zone = zone;
    this.certificate = new acm.Certificate(this, "SiteCert", {
      domainName: props.domain,
      subjectAlternativeNames: [`www.${props.domain}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });
    new CfnOutput(this, "NameServers", {
      value: Fn.join(", ", zone.hostedZoneNameServers!),
      description: "Put these four nameservers into GoDaddy for your domain",
    });
  }
}
