import { execFile } from "node:child_process";
import { delimiter, dirname } from "node:path";

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
    const inheritedPath = environment.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
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

export const runExecutable: ExecutableRunner = (executable, arguments_, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      [...arguments_],
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
