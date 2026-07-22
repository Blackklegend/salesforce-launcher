import { getPreferenceValues, open } from "@raycast/api";

import { SalesforceOrg, getOrgTarget } from "../models/salesforce-org";
import { findSalesforceCliPath } from "./cli-discovery";
import { readAuthenticatedOrgCache, writeAuthenticatedOrgCache } from "./org-cache";
import { generateOrgUrlWithCli, listAuthenticatedOrgsWithCli, openOrgPrivatelyWithCli } from "./salesforce-cli";

interface SalesforcePreferences {
  sfPath?: string;
}

export interface AuthenticatedOrgList {
  orgs: SalesforceOrg[];
  fromCache: boolean;
  isStale: boolean;
}

export async function listAuthenticatedOrgs(
  options: { forceRefresh?: boolean; allowStaleCache?: boolean } = {},
): Promise<AuthenticatedOrgList> {
  const cliPath = await getCliPath();

  if (!options.forceRefresh) {
    const freshCache = await readAuthenticatedOrgCache(cliPath);
    if (freshCache) return { orgs: freshCache, fromCache: true, isStale: false };

    if (options.allowStaleCache) {
      const staleCache = await readAuthenticatedOrgCache(cliPath, { allowStale: true });
      if (staleCache) return { orgs: staleCache, fromCache: true, isStale: true };
    }
  }

  const orgs = await listAuthenticatedOrgsWithCli(cliPath);
  try {
    await writeAuthenticatedOrgCache(cliPath, orgs);
  } catch {
    // Caching is an optimization. A storage failure must not hide a valid CLI result.
  }
  return { orgs, fromCache: false, isStale: false };
}

export async function generateOrgUrl(org: SalesforceOrg, path?: string): Promise<string> {
  const cliPath = await getCliPath();
  return generateOrgUrlWithCli(cliPath, getOrgTarget(org), { path });
}

export async function openSalesforceOrg(org: SalesforceOrg, path?: string): Promise<void> {
  const url = await generateOrgUrl(org, path);
  await open(url);
}

export async function openSalesforceOrgPrivately(org: SalesforceOrg, path?: string): Promise<void> {
  const cliPath = await getCliPath();
  await openOrgPrivatelyWithCli(cliPath, getOrgTarget(org), { path });
}

async function getCliPath(): Promise<string> {
  const preferences = getPreferenceValues<SalesforcePreferences>();
  return findSalesforceCliPath({ configuredPath: preferences.sfPath });
}
