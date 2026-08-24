import { describe, expect, it, vi } from "vitest";

import { buildSafeCliEnvironment, resolveExecutableInvocation } from "../services/cli-executor";

describe("buildSafeCliEnvironment", () => {
  it("preserves a case-insensitive inherited Path entry", () => {
    const environment = buildSafeCliEnvironment({ Path: "/custom/bin" }, {}, "/tools/sf");

    expect(environment.PATH).toBe("/tools:/custom/bin");
    expect(environment.Path).toBeUndefined();
  });
});

describe("resolveExecutableInvocation", () => {
  it("executes native binaries directly", () => {
    expect(
      resolveExecutableInvocation("C:\\Program Files\\sf\\bin\\sf.exe", ["org", "list"], { platform: "win32" }),
    ).toEqual({
      executable: "C:\\Program Files\\sf\\bin\\sf.exe",
      arguments: ["org", "list"],
    });
  });

  it("resolves an npm-installed sf.cmd shim without using a shell", () => {
    const executable = "C:\\Users\\test\\AppData\\Roaming\\npm\\sf.cmd";
    const runner = "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@salesforce\\cli\\bin\\run.js";
    const fileExists = vi.fn((path: string) => path === runner);

    expect(
      resolveExecutableInvocation(executable, ["org", "open", "--target-org", 'dev" & calc.exe &'], {
        platform: "win32",
        fileExists,
        nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      }),
    ).toEqual({
      executable: "C:\\Program Files\\nodejs\\node.exe",
      arguments: [runner, "org", "open", "--target-org", 'dev" & calc.exe &'],
    });
  });

  it("reports an unsupported Windows shim instead of launching a shell", () => {
    expect(() =>
      resolveExecutableInvocation("C:\\custom\\sf.cmd", ["org", "list"], {
        platform: "win32",
        fileExists: () => false,
      }),
    ).toThrow("Node.js entry point could not be located");
  });
});
