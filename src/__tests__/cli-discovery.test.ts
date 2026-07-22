import { describe, expect, it, vi } from "vitest";

import { findSalesforceCliPath } from "../services/cli-discovery";

describe("findSalesforceCliPath", () => {
  it("uses a valid configured absolute path first", async () => {
    const access = fakeAccess(["/custom/bin/sf"]);
    await expect(findSalesforceCliPath({ configuredPath: "/custom/bin/sf", access, useCache: false })).resolves.toBe(
      "/custom/bin/sf",
    );
  });

  it("rejects an invalid configured path instead of falling back", async () => {
    await expect(
      findSalesforceCliPath({
        configuredPath: "/missing/sf",
        pathEnvironment: "/working/bin",
        access: fakeAccess(["/working/bin/sf"]),
        useCache: false,
      }),
    ).rejects.toMatchObject({ code: "CONFIGURED_CLI_INVALID" });
  });

  it("checks Apple Silicon Homebrew before PATH", async () => {
    await expect(
      findSalesforceCliPath({
        pathEnvironment: "/nvm/bin",
        platform: "darwin",
        access: fakeAccess(["/opt/homebrew/bin/sf", "/nvm/bin/sf"]),
        useCache: false,
      }),
    ).resolves.toBe("/opt/homebrew/bin/sf");
  });

  it("finds an NVM-installed CLI through controlled PATH scanning", async () => {
    const cli = "/Users/test/.nvm/versions/node/v24/bin/sf";
    await expect(
      findSalesforceCliPath({
        pathEnvironment: "/usr/bin:/Users/test/.nvm/versions/node/v24/bin",
        platform: "darwin",
        access: fakeAccess([cli]),
        useCache: false,
      }),
    ).resolves.toBe(cli);
  });

  it("discovers an NVM installation when Raycast's PATH omits it", async () => {
    const cli = "/Users/test/.nvm/versions/node/v24.18.0/bin/sf";
    await expect(
      findSalesforceCliPath({
        pathEnvironment: "/usr/bin:/bin",
        platform: "darwin",
        homeDirectory: "/Users/test",
        readDirectory: async () => ["v22.1.0", "v24.18.0"],
        access: fakeAccess([cli]),
        useCache: false,
      }),
    ).resolves.toBe(cli);
  });

  it("fails with a dedicated error when no executable exists", async () => {
    await expect(
      findSalesforceCliPath({ pathEnvironment: "", access: fakeAccess([]), useCache: false }),
    ).rejects.toMatchObject({ code: "CLI_NOT_FOUND" });
  });
});

function fakeAccess(executablePaths: string[]) {
  return vi.fn(async (path: string) => {
    if (!executablePaths.includes(path)) throw new Error("ENOENT");
  });
}
