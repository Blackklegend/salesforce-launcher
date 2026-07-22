export interface SalesforceOrg {
  /** Stable within a normalized org list. Never derived from an access token. */
  key: string;
  aliases: string[];
  username?: string;
  orgId?: string;
  instanceUrl?: string;
  oauthMethod?: string;
  isDefaultOrg: boolean;
  isDefaultDevHub: boolean;
  isDevHub: boolean;
  isScratchOrg: boolean;
  isSandbox?: boolean;
  isExpired?: boolean;
  authorizationError?: string;
}

export function getPrimaryAlias(org: SalesforceOrg): string | undefined {
  return org.aliases[0];
}

export function getOrgTarget(org: SalesforceOrg): string {
  const target = org.username ?? getPrimaryAlias(org);

  if (!target) {
    throw new Error("Salesforce org does not have a usable target identifier");
  }

  return target;
}

export function getOrgLabel(org: SalesforceOrg): string {
  return getPrimaryAlias(org) ?? org.username ?? org.orgId ?? "Unknown org";
}
