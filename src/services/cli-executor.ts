import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, extname, join, win32 } from "node:path";

export interface ExecutableResult {
  stdout: string;
  stderr: string;
}

export interface ExecutableOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  environment?: NodeJS.ProcessEnv;
}

export type ExecutableRunner = (
  executable: string,
  arguments_: readonly string[],
  options?: ExecutableOptions,
) => Promise<ExecutableResult>;

interface ExecutableInvocation {
  executable: string;
  arguments: readonly string[];
}

export class ExecutableError extends Error {
  constructor(
    readonly stdout: string,
    readonly stderr: string,
    readonly timedOut: boolean,
    options?: ErrorOptions,
  ) {
    super(timedOut ? "Executable timed out" : "Executable failed", options);
    this.name = "ExecutableError";
  }
}

export function buildSafeCliEnvironment(
  parentEnvironment: NodeJS.ProcessEnv = process.env,
  additions: NodeJS.ProcessEnv = {},
  executable?: string,
): NodeJS.ProcessEnv {
  const environment = { ...parentEnvironment, ...additions };

  // FORCE_OPEN_URL is also consumed by `sf org open --path`; an inherited value
  // must never redirect a launcher action.
  delete environment.FORCE_OPEN_URL;

  if (executable) {
    const executableDirectory = dirname(executable);
    const pathKeys = Object.keys(environment).filter((key) => key.toLowerCase() === "path");
    const inheritedPath =
      pathKeys.map((key) => environment[key]).find((value): value is string => typeof value === "string") ??
      (process.platform === "win32"
        ? "C:\\Windows\\System32;C:\\Windows"
        : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    for (const key of pathKeys) delete environment[key];
    const pathEntries = inheritedPath.split(delimiter).filter(Boolean);
    environment.PATH = [executableDirectory, ...pathEntries.filter((entry) => entry !== executableDirectory)].join(
      delimiter,
    );
  }

  return {
    ...environment,
    SF_TEMP_SHOW_SECRETS: "false",
    SF_DISABLE_LOG_FILE: "true",
    SFDX_DISABLE_LOG_FILE: "true",
    SF_DISABLE_TELEMETRY: "true",
    SFDX_DISABLE_TELEMETRY: "true",
    SF_AUTOUPDATE_DISABLE: "true",
    SFDX_AUTOUPDATE_DISABLE: "true",
    NO_COLOR: "1",
  };
}

export function resolveExecutableInvocation(
  executable: string,
  arguments_: readonly string[],
  options: {
    platform?: NodeJS.Platform;
    fileExists?: (path: string) => boolean;
    nodeExecutable?: string;
  } = {},
): ExecutableInvocation {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? win32 : { dirname, extname, join };
  const extension = pathApi.extname(executable).toLowerCase();
  if (platform !== "win32" || (extension !== ".cmd" && extension !== ".bat")) {
    return { executable, arguments: arguments_ };
  }

  // Windows cannot execute .cmd/.bat files with execFile(). Salesforce's
  // supported shims all delegate to a JavaScript entry point, so invoke that
  // entry point with Node instead of introducing a shell and its injection risk.
  const executableDirectory = pathApi.dirname(executable);
  const runnerCandidates = [
    pathApi.join(executableDirectory, "node_modules", "@salesforce", "cli", "bin", "run.js"),
    pathApi.join(executableDirectory, "node_modules", "@salesforce", "cli", "bin", "run"),
    pathApi.join(executableDirectory, "run.js"),
    pathApi.join(executableDirectory, "run"),
  ];
  const runner = runnerCandidates.find(options.fileExists ?? existsSync);
  if (!runner) {
    throw new Error(
      "The Salesforce CLI Windows command shim was found, but its Node.js entry point could not be located. Configure the path to sf.exe or reinstall Salesforce CLI.",
    );
  }

  return {
    executable: options.nodeExecutable ?? process.execPath,
    arguments: [runner, ...arguments_],
  };
}

export const runExecutable: ExecutableRunner = (executable, arguments_, options = {}) =>
  new Promise((resolve, reject) => {
    const invocation = resolveExecutableInvocation(executable, arguments_);
    execFile(
      invocation.executable,
      [...invocation.arguments],
      {
        encoding: "utf8",
        env: buildSafeCliEnvironment(process.env, options.environment, executable),
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        timeout: options.timeoutMs ?? 15_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new ExecutableError(stdout, stderr, Boolean(error.killed || error.signal === "SIGTERM"), {
              cause: error,
            }),
          );
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
