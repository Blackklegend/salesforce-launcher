import { mkdir, mkdtemp, readdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SalesforceOrg, getPrimaryAlias } from "../models/salesforce-org";
import { clearAuthenticatedOrgCache } from "./org-cache";
import { loginWithSfdxAuthFile, revealSfdxAuthUrl } from "./org-service";

const MAX_AUTH_FILES = 500;

export interface AuthTransferResult {
  succeeded: number;
  skipped: number;
  cleanupFailed: number;
  failures: string[];
}

export interface ImportableAuthFile {
  path: string;
  name: string;
  alias?: string;
}

export async function exportOrgAuthFiles(
  orgs: SalesforceOrg[],
  outputDirectory: string,
  options: { includeScratch?: boolean } = {},
): Promise<AuthTransferResult> {
  await mkdir(outputDirectory, { mode: 0o700 });
  const result: AuthTransferResult = { succeeded: 0, skipped: 0, cleanupFailed: 0, failures: [] };

  for (const org of orgs) {
    if (!org.username || (org.isScratchOrg && !options.includeScratch)) {
      result.skipped++;
      continue;
    }

    try {
      const authUrl = await revealSfdxAuthUrl(org);
      const stem = safeFileStem(org.username);
      await writeFile(join(outputDirectory, `${stem}.authurl`), `${authUrl}\n`, { mode: 0o600, flag: "wx" });
      const alias = getPrimaryAlias(org);
      if (alias) await writeFile(join(outputDirectory, `${stem}.alias`), `${alias}\n`, { mode: 0o600, flag: "wx" });
      result.succeeded++;
    } catch {
      result.skipped++;
      result.failures.push(org.username);
    }
  }

  return result;
}

export async function importOrgAuthFiles(
  inputLocations: string | string[],
  options: { deleteAfterImport?: boolean } = {},
): Promise<AuthTransferResult> {
  const authFiles = await collectAuthFiles(Array.isArray(inputLocations) ? inputLocations : [inputLocations]);
  const result: AuthTransferResult = { succeeded: 0, skipped: 0, cleanupFailed: 0, failures: [] };

  for (const authFile of authFiles) {
    const stem = basename(authFile).slice(0, -".authurl".length);
    const aliasFile = join(dirname(authFile), `${stem}.alias`);
    const alias = await readOptionalAlias(aliasFile);
    try {
      await loginWithSfdxAuthFile(authFile, alias);
    } catch {
      result.skipped++;
      result.failures.push(alias || basename(authFile));
      continue;
    }

    result.succeeded++;
    if (options.deleteAfterImport) {
      try {
        await unlink(authFile);
        await unlinkIfPresent(aliasFile);
      } catch {
        result.cleanupFailed++;
      }
    }
  }

  if (result.succeeded > 0) await clearAuthenticatedOrgCache();
  return result;
}

export async function discoverImportableAuthFiles(inputLocations: string | string[]): Promise<ImportableAuthFile[]> {
  const authFiles = await collectAuthFiles(Array.isArray(inputLocations) ? inputLocations : [inputLocations]);
  return Promise.all(
    authFiles.map(async (path) => {
      const name = basename(path);
      const stem = name.slice(0, -".authurl".length);
      return {
        path,
        name,
        alias: await readOptionalAlias(join(dirname(path), `${stem}.alias`)),
      };
    }),
  );
}

export async function importSfdxAuthUrls(authUrls: string[]): Promise<AuthTransferResult> {
  if (authUrls.length > MAX_AUTH_FILES) throw new Error(`Import is limited to ${MAX_AUTH_FILES} credentials.`);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "sf-org-auth-import-"));
  const result: AuthTransferResult = { succeeded: 0, skipped: 0, cleanupFailed: 0, failures: [] };

  try {
    for (const [index, authUrl] of authUrls.entries()) {
      const authFile = join(temporaryDirectory, `credential-${index + 1}.authurl`);
      try {
        await writeFile(authFile, `${authUrl}\n`, { mode: 0o600, flag: "wx" });
        await loginWithSfdxAuthFile(authFile);
        result.succeeded++;
      } catch {
        result.skipped++;
        result.failures.push(`pasted credential ${index + 1}`);
      } finally {
        await unlinkIfPresent(authFile);
      }
    }
  } finally {
    await rmdir(temporaryDirectory).catch(() => undefined);
  }

  if (result.succeeded > 0) await clearAuthenticatedOrgCache();
  return result;
}

export function parseSfdxAuthUrls(value: string): string[] {
  const values = value
    .split(/\r?\n/)
    .map((authUrl) => authUrl.trim())
    .filter(Boolean);
  for (const authUrl of values) {
    if (!authUrl.startsWith("force://")) throw new Error("SFDX auth URLs must start with force://.");
    if (authUrl.length > 16_384) throw new Error("The pasted SFDX auth URL is too long.");
  }
  return values;
}

export function parseLocalImportLocations(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((location) => normalizeLocalImportLocation(location))
    .filter((location): location is string => Boolean(location));
}

function normalizeLocalImportLocation(value: string): string | undefined {
  let location = value.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
  if (!location) return undefined;
  if (location.startsWith("file://")) {
    try {
      location = fileURLToPath(location);
    } catch {
      throw new Error("The pasted file link is invalid.");
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location) || location.startsWith("force://")) {
    throw new Error("Only local file paths and file:// links can be imported.");
  }
  if (location === "~") location = homedir();
  else if (location.startsWith("~/")) location = join(homedir(), location.slice(2));
  if (!isAbsolute(location)) throw new Error("Import paths must be absolute.");
  return location;
}

async function collectAuthFiles(locations: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const location of locations) {
    const metadata = await stat(location);
    if (metadata.isDirectory()) {
      const entries = await readdir(location, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".authurl")) files.add(join(location, entry.name));
      }
    } else if (metadata.isFile() && location.endsWith(".authurl")) {
      files.add(location);
    } else {
      throw new Error("Choose an export folder or an .authurl file.");
    }
    if (files.size > MAX_AUTH_FILES) throw new Error(`Import is limited to ${MAX_AUTH_FILES} credential files.`);
  }
  return [...files].sort();
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function safeFileStem(username: string): string {
  const safe = username.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return (safe || "org").slice(0, 180);
}

async function readOptionalAlias(path: string): Promise<string | undefined> {
  try {
    const alias = (await readFile(path, { encoding: "utf8" })).trim();
    return alias ? alias.slice(0, 256) : undefined;
  } catch {
    return undefined;
  }
}
