import { SalesforceOrg } from "../models/salesforce-org";

export const ORG_SECTION_ORDER = ["Default", "Scratch Orgs", "Sandboxes", "Production", "Dev Hubs", "Other"] as const;
export type OrgSection = (typeof ORG_SECTION_ORDER)[number];

export function classifyOrg(org: SalesforceOrg): OrgSection {
  if (org.isDefaultOrg || org.isDefaultDevHub) return "Default";
  if (org.isScratchOrg) return "Scratch Orgs";
  if (org.isSandbox === true) return "Sandboxes";
  if (org.isSandbox === false && !org.isScratchOrg) return "Production";
  if (org.isDevHub) return "Dev Hubs";
  return "Other";
}

export function getOrgTypeLabel(org: SalesforceOrg): string | undefined {
  if (org.isScratchOrg) return "Scratch";
  if (org.isSandbox === true) return "Sandbox";
  if (org.isSandbox === false) return "Production";
  if (org.isDevHub) return "Dev Hub";
  return undefined;
}
