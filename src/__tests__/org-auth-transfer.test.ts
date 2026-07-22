import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SalesforceOrg } from "../models/salesforce-org";
import {
  discoverImportableAuthFiles,
  exportOrgAuthFiles,
  importOrgAuthFiles,
  importSfdxAuthUrls,
  parseLocalImportLocations,
  parseSfdxAuthUrls,
} from "../services/org-auth-transfer";
import { clearAuthenticatedOrgCache } from "../services/org-cache";
import { loginWithSfdxAuthFile, revealSfdxAuthUrl } from "../services/org-service";

vi.mock("../services/org-cache", () => ({ clearAuthenticatedOrgCache: vi.fn() }));
vi.mock("../services/org-service", () => ({
  loginWithSfdxAuthFile: vi.fn(),
  revealSfdxAuthUrl: vi.fn(),
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("org auth transfer", () => {
  it("exports credentials to owner-only files and skips scratch orgs by default", async () => {
    const parent = await createTemporaryDirectory();
    const output = join(parent, "export");
    vi.mocked(revealSfdxAuthUrl).mockResolvedValue("force://client:secret:token@example.com");

    const result = await exportOrgAuthFiles(
      [org("user@example.com", "dev"), org("scratch@example.com", "scratch", true)],
      output,
    );

    expect(result).toMatchObject({ succeeded: 1, skipped: 1 });
    expect(await readFile(join(output, "user_example.com.authurl"), "utf8")).toBe(
      "force://client:secret:token@example.com\n",
    );
    expect(await readFile(join(output, "user_example.com.alias"), "utf8")).toBe("dev\n");
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(output, "user_example.com.authurl"))).mode & 0o777).toBe(0o600);
  });

  it("imports by file path, restores aliases, and only deletes successful imports", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "good.authurl"), "force://good");
    await writeFile(join(directory, "good.alias"), "dev\n");
    await writeFile(join(directory, "bad.authurl"), "force://bad");
    vi.mocked(loginWithSfdxAuthFile).mockImplementation(async (path) => {
      if (path.endsWith("bad.authurl")) throw new Error("failed");
    });

    const result = await importOrgAuthFiles(directory, { deleteAfterImport: true });

    expect(result).toMatchObject({ succeeded: 1, skipped: 1, cleanupFailed: 0 });
    expect(result.failures).toEqual(["bad.authurl"]);
    expect(loginWithSfdxAuthFile).toHaveBeenCalledWith(join(directory, "good.authurl"), "dev");
    await expect(stat(join(directory, "good.authurl"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(directory, "good.alias"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(directory, "bad.authurl"))).resolves.toBeDefined();
    expect(clearAuthenticatedOrgCache).toHaveBeenCalledOnce();
  });

  it("identifies a failed import by alias when one is available", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "broken.authurl"), "force://broken");
    await writeFile(join(directory, "broken.alias"), "staging\n");
    vi.mocked(loginWithSfdxAuthFile).mockRejectedValue(new Error("failed"));

    const result = await importOrgAuthFiles(directory);

    expect(result.failures).toEqual(["staging"]);
  });

  it("discovers credential files for review with their aliases", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "second.authurl"), "force://second");
    await writeFile(join(directory, "first.authurl"), "force://first");
    await writeFile(join(directory, "first.alias"), "development\n");
    await writeFile(join(directory, "notes.txt"), "ignored");

    await expect(discoverImportableAuthFiles(directory)).resolves.toEqual([
      { path: join(directory, "first.authurl"), name: "first.authurl", alias: "development" },
      { path: join(directory, "second.authurl"), name: "second.authurl", alias: undefined },
    ]);
  });

  it("imports a pasted auth URL through a temporary file and removes it", async () => {
    let temporaryFile = "";
    vi.mocked(loginWithSfdxAuthFile).mockImplementation(async (path) => {
      temporaryFile = path;
      expect(await readFile(path, "utf8")).toBe("force://client:secret:token@example.com\n");
    });

    const result = await importSfdxAuthUrls(["force://client:secret:token@example.com"]);

    expect(result).toMatchObject({ succeeded: 1, skipped: 0 });
    expect(loginWithSfdxAuthFile).toHaveBeenCalledWith(temporaryFile);
    await expect(stat(temporaryFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts absolute paths and file links while validating direct auth URLs", () => {
    expect(parseLocalImportLocations("/tmp/export\nfile:///tmp/dev.authurl")).toEqual([
      "/tmp/export",
      "/tmp/dev.authurl",
    ]);
    expect(parseSfdxAuthUrls("force://one\nforce://two")).toEqual(["force://one", "force://two"]);
    expect(() => parseLocalImportLocations("https://example.com/export")).toThrow("Only local file paths");
    expect(() => parseSfdxAuthUrls("https://example.com/credential")).toThrow("must start with force://");
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sf-org-auth-transfer-"));
  temporaryDirectories.push(directory);
  return directory;
}

function org(username: string, alias: string, isScratchOrg = false): SalesforceOrg {
  return {
    key: username,
    aliases: [alias],
    username,
    isDefaultOrg: false,
    isDefaultDevHub: false,
    isDevHub: false,
    isScratchOrg,
  };
}
