import { LocalStorage } from "@raycast/api";

import { SalesforceOrg } from "../models/salesforce-org";

const CACHE_KEY = "authenticated-orgs-v1";
const CACHE_SCHEMA_VERSION = 1;
export const ORG_CACHE_TTL_MS = 45_000;

interface OrgCachePayload {
  schemaVersion: number;
  cliPath: string;
  cachedAt: number;
  orgs: SalesforceOrg[];
}

export async function readAuthenticatedOrgCache(
  cliPath: string,
  options: { allowStale?: boolean; now?: number } = {},
): Promise<SalesforceOrg[] | undefined> {
  try {
    const serialized = await LocalStorage.getItem<string>(CACHE_KEY);
    if (!serialized) return undefined;

    const payload = parseCachePayload(JSON.parse(serialized) as unknown);
    const age = (options.now ?? Date.now()) - payload.cachedAt;
    if (payload.cliPath !== cliPath || (!options.allowStale && age > ORG_CACHE_TTL_MS)) return undefined;
    return payload.orgs;
  } catch {
    try {
      await LocalStorage.removeItem(CACHE_KEY);
    } catch {
      // Cache cleanup is best-effort. The CLI remains the source of truth.
    }
    return undefined;
  }
}

export async function writeAuthenticatedOrgCache(
  cliPath: string,
  orgs: SalesforceOrg[],
  now = Date.now(),
): Promise<void> {
  const payload: OrgCachePayload = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    cliPath,
    cachedAt: now,
    // Explicitly whitelist every persisted field. Future parser changes cannot
    // accidentally make raw CLI data part of the cache.
    orgs: orgs.map(toCacheOrg),
  };
  await LocalStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

function toCacheOrg(org: SalesforceOrg): SalesforceOrg {
  return {
    key: org.key,
    aliases: [...org.aliases],
    username: org.username,
    orgId: org.orgId,
    instanceUrl: org.instanceUrl,
    oauthMethod: org.oauthMethod,
    isDefaultOrg: org.isDefaultOrg,
    isDefaultDevHub: org.isDefaultDevHub,
    isDevHub: org.isDevHub,
    isScratchOrg: org.isScratchOrg,
    isSandbox: org.isSandbox,
    isExpired: org.isExpired,
    authorizationError: org.authorizationError,
  };
}

export async function clearAuthenticatedOrgCache(): Promise<void> {
  await LocalStorage.removeItem(CACHE_KEY);
}

function parseCachePayload(value: unknown): OrgCachePayload {
  if (!isRecord(value) || value.schemaVersion !== CACHE_SCHEMA_VERSION || typeof value.cliPath !== "string") {
    throw new Error("Invalid org cache");
  }
  if (typeof value.cachedAt !== "number" || !Array.isArray(value.orgs)) throw new Error("Invalid org cache");

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    cliPath: value.cliPath,
    cachedAt: value.cachedAt,
    orgs: value.orgs.map(parseCachedOrg),
  };
}

function parseCachedOrg(value: unknown): SalesforceOrg {
  if (!isRecord(value) || typeof value.key !== "string" || !Array.isArray(value.aliases)) {
    throw new Error("Invalid cached org");
  }

  const aliases = value.aliases.filter((alias): alias is string => typeof alias === "string");
  const username = optionalString(value.username);
  if (aliases.length === 0 && !username) throw new Error("Cached org does not have a target identifier");
  if (typeof value.isDefaultOrg !== "boolean" || typeof value.isDefaultDevHub !== "boolean") {
    throw new Error("Invalid cached org");
  }
  if (typeof value.isDevHub !== "boolean" || typeof value.isScratchOrg !== "boolean") {
    throw new Error("Invalid cached org");
  }

  return {
    key: value.key,
    aliases,
    username,
    orgId: optionalString(value.orgId),
    instanceUrl: optionalString(value.instanceUrl),
    oauthMethod: optionalString(value.oauthMethod),
    isDefaultOrg: value.isDefaultOrg,
    isDefaultDevHub: value.isDefaultDevHub,
    isDevHub: value.isDevHub,
    isScratchOrg: value.isScratchOrg,
    isSandbox: optionalBoolean(value.isSandbox),
    isExpired: optionalBoolean(value.isExpired),
    authorizationError: optionalString(value.authorizationError),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
