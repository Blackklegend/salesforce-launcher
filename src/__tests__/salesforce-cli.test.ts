import { describe, expect, it, vi } from "vitest";

import { buildSafeCliEnvironment, ExecutableError, ExecutableRunner } from "../services/cli-executor";
import {
  generateOrgUrlWithCli,
  listAuthenticatedOrgsWithCli,
  loginWithSfdxAuthFileWithCli,
  openOrgPrivatelyWithCli,
  revealSfdxAuthUrlWithCli,
} from "../services/salesforce-cli";
import { SalesforceLauncherError } from "../utils/errors";

describe("Salesforce CLI service", () => {
  it("lists orgs with an argument array and ignores warnings on stderr", async () => {
    const runner = vi.fn<ExecutableRunner>().mockResolvedValue({
      stdout: JSON.stringify({ status: 0, result: [{ alias: "dev", username: "dev@example.com" }] }),
      stderr: "A non-fatal warning",
    });

    await expect(listAuthenticatedOrgsWithCli("/bin/sf", runner)).resolves.toHaveLength(1);
    expect(runner).toHaveBeenCalledWith("/bin/sf", ["org", "list", "auth", "--json"], { timeoutMs: 15_000 });
  });

  it("passes target input as one inert argument", async () => {
    const runner = successfulUrlRunner();
    const target = 'dev"; open /Applications/Calculator.app; #';

    await generateOrgUrlWithCli("/bin/sf", target, { runner });

    expect(runner).toHaveBeenCalledWith("/bin/sf", ["org", "open", "--target-org", target, "--url-only", "--json"], {
      timeoutMs: 30_000,
    });
  });

  it("adds a validated destination path", async () => {
    const runner = successfulUrlRunner();
    await generateOrgUrlWithCli("/bin/sf", "dev", { path: "/lightning/setup/SetupOneHome/home", runner });

    expect(runner).toHaveBeenCalledWith(
      "/bin/sf",
      ["org", "open", "--target-org", "dev", "--path", "/lightning/setup/SetupOneHome/home", "--url-only", "--json"],
      { timeoutMs: 30_000 },
    );
  });

  it("uses the CLI's mutually exclusive private mode without returning JSON", async () => {
    const runner = vi.fn<ExecutableRunner>().mockResolvedValue({ stdout: "", stderr: "" });
    await openOrgPrivatelyWithCli("/bin/sf", "dev@example.com", { path: "/lightning", runner });

    expect(runner).toHaveBeenCalledWith(
      "/bin/sf",
      ["org", "open", "--target-org", "dev@example.com", "--private", "--path", "/lightning"],
      { timeoutMs: 30_000 },
    );
  });

  it("rejects missing, malformed, non-HTTPS URLs and unsafe destination paths", async () => {
    await expect(
      generateOrgUrlWithCli("/bin/sf", "dev", { runner: jsonRunner({ status: 0, result: {} }) }),
    ).rejects.toMatchObject({
      code: "INVALID_CLI_RESPONSE",
    });
    await expect(
      generateOrgUrlWithCli("/bin/sf", "dev", {
        runner: jsonRunner({ status: 0, result: { url: "http://example.com" } }),
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });
    await expect(
      generateOrgUrlWithCli("/bin/sf", "dev", { path: "https://evil.example", runner: successfulUrlRunner() }),
    ).rejects.toMatchObject({
      code: "INVALID_DESTINATION",
    });
  });

  it("maps timeouts and strips authenticated URLs from errors", async () => {
    const timeoutRunner = vi.fn<ExecutableRunner>().mockRejectedValue(new ExecutableError("", "", true));
    await expect(listAuthenticatedOrgsWithCli("/bin/sf", timeoutRunner)).rejects.toMatchObject({ code: "CLI_TIMEOUT" });

    const failedRunner = vi
      .fn<ExecutableRunner>()
      .mockRejectedValue(
        new ExecutableError(
          "",
          "Failed at https://example.my.salesforce.com/secur/frontdoor.jsp?sid=secret force://client:secret:token@example.com",
          false,
        ),
      );

    try {
      await generateOrgUrlWithCli("/bin/sf", "dev", { runner: failedRunner });
      throw new Error("Expected URL generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SalesforceLauncherError);
      expect((error as Error).message).not.toContain("frontdoor");
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).not.toContain("force://");
    }
  });

  it("maps macOS Keychain failures distinctly", async () => {
    const runner = vi
      .fn<ExecutableRunner>()
      .mockRejectedValue(
        new ExecutableError("", "SecKeychain: Unable to obtain authorization for this operation", false),
      );

    await expect(listAuthenticatedOrgsWithCli("/bin/sf", runner)).rejects.toMatchObject({
      code: "KEYCHAIN_ACCESS_DENIED",
    });
  });

  it("reveals an SFDX auth URL only from structured CLI output", async () => {
    const runner = jsonRunner({ status: 0, result: { sfdxAuthUrl: "force://client:secret:token@example.com" } });

    await expect(revealSfdxAuthUrlWithCli("/bin/sf", "dev@example.com", runner)).resolves.toBe(
      "force://client:secret:token@example.com",
    );
    expect(runner).toHaveBeenCalledWith(
      "/bin/sf",
      ["org", "auth", "show-sfdx-auth-url", "--target-org", "dev@example.com", "--json"],
      { timeoutMs: 30_000 },
    );
  });

  it("imports credentials by file path without putting their contents in arguments", async () => {
    const runner = vi.fn<ExecutableRunner>().mockResolvedValue({ stdout: "", stderr: "" });

    await loginWithSfdxAuthFileWithCli("/bin/sf", "/secure/dev.authurl", { alias: "dev", runner });

    expect(runner).toHaveBeenCalledWith(
      "/bin/sf",
      ["org", "login", "sfdx-url", "--sfdx-url-file", "/secure/dev.authurl", "--json", "--alias", "dev"],
      { timeoutMs: 30_000 },
    );
  });

  it("forces a secret-safe child environment and removes ambient paths", () => {
    const environment = buildSafeCliEnvironment(
      {
        SF_TEMP_SHOW_SECRETS: "true",
        FORCE_OPEN_URL: "/unexpected",
        KEEP_ME: "yes",
        PATH: "/usr/bin:/bin",
      },
      { SF_TEMP_SHOW_SECRETS: "true" },
      "/Users/test/.nvm/versions/node/v24.18.0/bin/sf",
    );

    expect(environment).toMatchObject({
      SF_TEMP_SHOW_SECRETS: "false",
      SF_DISABLE_LOG_FILE: "true",
      SFDX_DISABLE_LOG_FILE: "true",
      SF_DISABLE_TELEMETRY: "true",
      SFDX_DISABLE_TELEMETRY: "true",
      SF_AUTOUPDATE_DISABLE: "true",
      SFDX_AUTOUPDATE_DISABLE: "true",
      NO_COLOR: "1",
      KEEP_ME: "yes",
    });
    expect(environment).not.toHaveProperty("FORCE_OPEN_URL");
    expect(environment.PATH).toBe("/Users/test/.nvm/versions/node/v24.18.0/bin:/usr/bin:/bin");
  });
});

function successfulUrlRunner(): ReturnType<typeof vi.fn<ExecutableRunner>> {
  return jsonRunner({
    status: 0,
    result: { url: "https://example.my.salesforce.com/secur/frontdoor.jsp?sid=redacted" },
  });
}

function jsonRunner(value: unknown): ReturnType<typeof vi.fn<ExecutableRunner>> {
  return vi.fn<ExecutableRunner>().mockResolvedValue({ stdout: JSON.stringify(value), stderr: "" });
}
