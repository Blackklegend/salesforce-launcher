import { SalesforceOrg } from "../models/salesforce-org";
import { SalesforceLauncherError, sanitizeUserFacingMessage } from "../utils/errors";

type UnknownRecord = Record<string, unknown>;

interface RawOrgEntry {
  value: UnknownRecord;
  source: string;
}

const ORG_ARRAY_KEYS = ["nonScratchOrgs", "scratchOrgs", "devHubs", "orgs", "authorizations", "results"];
const DEFAULT_ORG_CONFIGS = new Set(["target-org", "defaultUsername"]);
const DEFAULT_DEV_HUB_CONFIGS = new Set(["target-dev-hub", "defaultDevHubUsername"]);

export function parseAuthenticatedOrgsResponse(input: unknown): SalesforceOrg[] {
  if (!isRecord(input)) {
    throw unexpectedResponse();
  }

  assertSuccessfulStatus(input);

  if (!("result" in input)) {
    throw unexpectedResponse();
  }

  const entries = collectOrgEntries(input.result);
  const normalized = entries.flatMap((entry) => {
    const org = normalizeOrg(entry);
    return org ? [org] : [];
  });

  const orgs = deduplicateOrgs(normalized);
  if (orgs.length === 0 && hasKeychainAccessWarning(input.warnings)) {
    throw new SalesforceLauncherError(
      "KEYCHAIN_ACCESS_DENIED",
      "Salesforce CLI could not read authorization credentials from macOS Keychain.",
    );
  }

  return orgs;
}

function hasKeychainAccessWarning(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(
    (warning) =>
      typeof warning === "string" &&
      /(SecKeychain|Keychain|Unable to obtain authorization for this operation)/i.test(warning),
  );
}

function collectOrgEntries(result: unknown): RawOrgEntry[] {
  if (Array.isArray(result)) {
    return result.filter(isRecord).map((value) => ({ value, source: "result" }));
  }

  if (!isRecord(result)) {
    throw unexpectedResponse();
  }

  const presentArrayKeys = ORG_ARRAY_KEYS.filter((key) => key in result);
  if (presentArrayKeys.length === 0) {
    throw unexpectedResponse();
  }

  return presentArrayKeys.flatMap((key) => {
    const value = result[key];
    if (!Array.isArray(value)) throw unexpectedResponse();
    return value.filter(isRecord).map((org) => ({ value: org, source: key }));
  });
}

function normalizeOrg({ value, source }: RawOrgEntry): SalesforceOrg | undefined {
  const aliases = readAliases(value);
  const username = readString(value.username);

  if (!username && aliases.length === 0) {
    return undefined;
  }

  const orgId = readString(value.orgId) ?? readString(value.id);
  const instanceUrl = readHttpsUrl(value.instanceUrl);
  const configs = readStringArray(value.configs);
  const isScratchOrg =
    readBoolean(value.isScratchOrg) ?? readBoolean(value.isScratch) ?? source.toLowerCase().includes("scratch");
  const isDevHub = readBoolean(value.isDevHub) ?? source.toLowerCase().includes("devhub");
  const explicitSandbox = readBoolean(value.isSandbox);
  const isSandbox = explicitSandbox ?? inferSandbox(instanceUrl);
  const authorizationError = readString(value.error);

  return {
    key: createStableKey({ aliases, username, orgId, instanceUrl }),
    aliases,
    username,
    orgId,
    instanceUrl,
    oauthMethod: readString(value.oauthMethod),
    isDefaultOrg:
      readBoolean(value.isDefaultOrg) ??
      readBoolean(value.isDefaultUsername) ??
      configs.some((config) => DEFAULT_ORG_CONFIGS.has(config)),
    isDefaultDevHub:
      readBoolean(value.isDefaultDevHub) ??
      readBoolean(value.isDefaultDevHubUsername) ??
      configs.some((config) => DEFAULT_DEV_HUB_CONFIGS.has(config)),
    isDevHub,
    isScratchOrg,
    isSandbox,
    isExpired: readExpired(value.isExpired),
    authorizationError: authorizationError ? sanitizeUserFacingMessage(authorizationError) : undefined,
  };
}

function deduplicateOrgs(orgs: SalesforceOrg[]): SalesforceOrg[] {
  const unique = new Map<string, SalesforceOrg>();

  for (const org of orgs) {
    const existing = unique.get(org.key);
    if (!existing) {
      unique.set(org.key, org);
      continue;
    }

    unique.set(org.key, {
      ...existing,
      ...org,
      aliases: [...new Set([...existing.aliases, ...org.aliases])],
      username: existing.username ?? org.username,
      orgId: existing.orgId ?? org.orgId,
      instanceUrl: existing.instanceUrl ?? org.instanceUrl,
      oauthMethod: existing.oauthMethod ?? org.oauthMethod,
      isDefaultOrg: existing.isDefaultOrg || org.isDefaultOrg,
      isDefaultDevHub: existing.isDefaultDevHub || org.isDefaultDevHub,
      isDevHub: existing.isDevHub || org.isDevHub,
      isScratchOrg: existing.isScratchOrg || org.isScratchOrg,
      isSandbox: existing.isSandbox ?? org.isSandbox,
      isExpired: existing.isExpired === true || org.isExpired === true ? true : (existing.isExpired ?? org.isExpired),
      authorizationError: existing.authorizationError ?? org.authorizationError,
    });
  }

  return [...unique.values()];
}

function readAliases(value: UnknownRecord): string[] {
  const rawAliases = value.aliases ?? value.alias;
  const values = Array.isArray(rawAliases) ? rawAliases : typeof rawAliases === "string" ? rawAliases.split(",") : [];
  return [...new Set(values.flatMap((alias) => (typeof alias === "string" ? [alias.trim()] : [])).filter(Boolean))];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "true") return true;
  if (value === 0 || value === "false") return false;
  return undefined;
}

function readExpired(value: unknown): boolean | undefined {
  return value === "unknown" ? undefined : readBoolean(value);
}

function readHttpsUrl(value: unknown): string | undefined {
  const raw = readString(value);
  if (!raw) return undefined;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function inferSandbox(instanceUrl?: string): boolean | undefined {
  if (!instanceUrl) return undefined;

  try {
    const hostname = new URL(instanceUrl).hostname.toLowerCase();
    return hostname.includes(".sandbox.") || hostname === "test.salesforce.com" ? true : undefined;
  } catch {
    return undefined;
  }
}

function createStableKey({
  aliases,
  username,
  orgId,
  instanceUrl,
}: Pick<SalesforceOrg, "aliases" | "username" | "orgId" | "instanceUrl">): string {
  const normalizedUsername = username?.toLowerCase();
  if (orgId && normalizedUsername) return `${orgId.toLowerCase()}:${normalizedUsername}`;
  if (normalizedUsername) return `${normalizedUsername}:${instanceUrl?.toLowerCase() ?? ""}`;
  return `alias:${aliases[0]?.toLowerCase() ?? "unknown"}:${(orgId ?? instanceUrl ?? "").toLowerCase()}`;
}

function assertSuccessfulStatus(root: UnknownRecord): void {
  if (!("status" in root)) return;

  const status = typeof root.status === "string" ? Number(root.status) : root.status;
  if (typeof status === "number" && status !== 0) {
    const message = readString(root.message) ?? "The Salesforce CLI command did not succeed.";
    throw new SalesforceLauncherError("CLI_FAILED", sanitizeUserFacingMessage(message));
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unexpectedResponse(): SalesforceLauncherError {
  return new SalesforceLauncherError("INVALID_CLI_RESPONSE", "Unexpected Salesforce CLI response shape");
}
