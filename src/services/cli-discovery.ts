import { constants } from "node:fs";
import { access as nodeAccess, readdir as nodeReadDirectory } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";

import { SalesforceLauncherError } from "../utils/errors";

export interface CliDiscoveryOptions {
  configuredPath?: string;
  pathEnvironment?: string;
  platform?: NodeJS.Platform;
  access?: (path: string, mode: number) => Promise<void>;
  readDirectory?: (path: string) => Promise<string[]>;
  homeDirectory?: string;
  useCache?: boolean;
}

const STANDARD_MACOS_PATHS = ["/opt/homebrew/bin/sf", "/usr/local/bin/sf", "/usr/bin/sf"];
const discoveryPromises = new Map<string, Promise<string>>();

export async function findSalesforceCliPath(options: CliDiscoveryOptions = {}): Promise<string> {
  const configuredPath = options.configuredPath?.trim();
  const platform = options.platform ?? process.platform;
  const pathEnvironment = options.pathEnvironment ?? process.env.PATH ?? "";
  const homeDirectory = options.homeDirectory ?? homedir();
  const cacheKey = `${platform}\0${configuredPath ?? ""}\0${pathEnvironment}\0${homeDirectory}`;

  if (options.useCache !== false && !options.access && !options.readDirectory) {
    const existing = discoveryPromises.get(cacheKey);
    if (existing) return existing;

    const pending = discover({ ...options, configuredPath, platform, pathEnvironment, homeDirectory });
    discoveryPromises.set(cacheKey, pending);

    try {
      return await pending;
    } catch (error) {
      discoveryPromises.delete(cacheKey);
      throw error;
    }
  }

  return discover({ ...options, configuredPath, platform, pathEnvironment, homeDirectory });
}

export function resetCliDiscoveryCache(): void {
  discoveryPromises.clear();
}

async function discover(
  options: CliDiscoveryOptions & {
    configuredPath?: string;
    pathEnvironment: string;
    platform: NodeJS.Platform;
    homeDirectory: string;
  },
): Promise<string> {
  const checkAccess = options.access ?? nodeAccess;

  if (options.configuredPath) {
    const absolute =
      options.platform === "win32" ? win32.isAbsolute(options.configuredPath) : isAbsolute(options.configuredPath);
    if (!absolute || !(await isExecutable(options.configuredPath, checkAccess))) {
      throw new SalesforceLauncherError(
        "CONFIGURED_CLI_INVALID",
        "The configured Salesforce CLI path does not exist or is not executable.",
      );
    }

    return options.configuredPath;
  }

  const directCandidates = [
    ...(options.platform === "darwin" ? STANDARD_MACOS_PATHS : []),
    ...pathCandidates(options.pathEnvironment, options.platform),
  ];

  for (const candidate of [...new Set(directCandidates)]) {
    if (await isExecutable(candidate, checkAccess)) return candidate;
  }

  if (options.platform === "darwin") {
    const nodeManagerPaths = await nodeManagerCandidates(
      options.homeDirectory,
      options.readDirectory ?? nodeReadDirectory,
    );
    for (const candidate of nodeManagerPaths) {
      if (await isExecutable(candidate, checkAccess)) return candidate;
    }
  }

  throw new SalesforceLauncherError(
    "CLI_NOT_FOUND",
    "Salesforce CLI was not found. Install it or configure its absolute path in extension preferences.",
  );
}

async function nodeManagerCandidates(
  homeDirectory: string,
  readDirectory: (path: string) => Promise<string[]>,
): Promise<string[]> {
  const staticCandidates = [
    join(homeDirectory, ".volta", "bin", "sf"),
    join(homeDirectory, ".asdf", "shims", "sf"),
    join(homeDirectory, ".local", "share", "mise", "shims", "sf"),
    join(homeDirectory, ".local", "share", "fnm", "aliases", "default", "bin", "sf"),
    join(homeDirectory, ".local", "bin", "sf"),
    join(homeDirectory, "Library", "pnpm", "sf"),
  ];
  const nvmVersionsDirectory = join(homeDirectory, ".nvm", "versions", "node");

  try {
    const versions = (await readDirectory(nvmVersionsDirectory)).sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }),
    );
    return [...staticCandidates, ...versions.map((version) => join(nvmVersionsDirectory, version, "bin", "sf"))];
  } catch {
    return staticCandidates;
  }
}

function pathCandidates(pathEnvironment: string, platform: NodeJS.Platform): string[] {
  const separator = platform === "win32" ? ";" : ":";
  const executableNames = platform === "win32" ? ["sf.exe", "sf.cmd", "sf.bat", "sf"] : ["sf"];

  return pathEnvironment
    .split(separator)
    .map((directory) => directory.trim())
    .filter(Boolean)
    .flatMap((directory) => executableNames.map((name) => join(directory, name)));
}

async function isExecutable(
  path: string,
  checkAccess: (path: string, mode: number) => Promise<void>,
): Promise<boolean> {
  try {
    await checkAccess(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
