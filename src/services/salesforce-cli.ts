import { SalesforceOrg } from "../models/salesforce-org";
import { SalesforceLauncherError, sanitizeUserFacingMessage } from "../utils/errors";
import { ExecutableError, ExecutableRunner, runExecutable } from "./cli-executor";
import { parseAuthenticatedOrgsResponse } from "./org-parser";

const LIST_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 30_000;

export async function listAuthenticatedOrgsWithCli(
  cliPath: string,
  runner: ExecutableRunner = runExecutable,
): Promise<SalesforceOrg[]> {
  try {
    const { stdout } = await runner(cliPath, ["org", "list", "auth", "--json"], {
      timeoutMs: LIST_TIMEOUT_MS,
    });
    return parseAuthenticatedOrgsResponse(parseCliJson(stdout));
  } catch (error) {
    throw mapCliError(error);
  }
}

export async function generateOrgUrlWithCli(
  cliPath: string,
  targetOrg: string,
  options: { path?: string; runner?: ExecutableRunner } = {},
): Promise<string> {
  const target = targetOrg.trim();
  if (!target) {
    throw new SalesforceLauncherError("CLI_FAILED", "The org target is empty.");
  }

  const arguments_ = ["org", "open", "--target-org", target, "--url-only", "--json"];
  if (options.path) arguments_.splice(4, 0, "--path", validateDestinationPath(options.path));

  try {
    const { stdout } = await (options.runner ?? runExecutable)(cliPath, arguments_, {
      timeoutMs: OPEN_TIMEOUT_MS,
    });
    const response = parseCliJson(stdout);
    const url = readGeneratedUrl(response);
    return validateGeneratedUrl(url);
  } catch (error) {
    throw mapCliError(error);
  }
}

export async function openOrgPrivatelyWithCli(
  cliPath: string,
  targetOrg: string,
  options: { path?: string; runner?: ExecutableRunner } = {},
): Promise<void> {
  const target = targetOrg.trim();
  if (!target) {
    throw new SalesforceLauncherError("CLI_FAILED", "The org target is empty.");
  }

  // `--private` and `--url-only` are mutually exclusive. Let Salesforce CLI
  // launch the browser directly, and omit `--json` so no authenticated URL is
  // returned to or retained by the extension.
  const arguments_ = ["org", "open", "--target-org", target, "--private"];
  if (options.path) arguments_.push("--path", validateDestinationPath(options.path));

  try {
    await (options.runner ?? runExecutable)(cliPath, arguments_, { timeoutMs: OPEN_TIMEOUT_MS });
  } catch (error) {
    throw mapCliError(error);
  }
}

function parseCliJson(stdout: string): unknown {
  const normalized = stdout.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new SalesforceLauncherError("INVALID_CLI_JSON", "Salesforce CLI returned no JSON output.");
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    throw new SalesforceLauncherError("INVALID_CLI_JSON", "Salesforce CLI returned invalid JSON.", { cause: error });
  }
}

function readGeneratedUrl(response: unknown): string {
  if (!isRecord(response)) {
    throw new SalesforceLauncherError("INVALID_CLI_RESPONSE", "Missing Salesforce CLI response wrapper.");
  }

  const status = typeof response.status === "string" ? Number(response.status) : response.status;
  if (typeof status === "number" && status !== 0) {
    throw new SalesforceLauncherError("CLI_FAILED", readSafeMessage(response));
  }

  if (!isRecord(response.result) || typeof response.result.url !== "string") {
    throw new SalesforceLauncherError("INVALID_CLI_RESPONSE", "Salesforce CLI did not return an org URL.");
  }

  return response.result.url;
}

function validateGeneratedUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname) {
      throw new SalesforceLauncherError("UNSAFE_URL", "Salesforce CLI returned a non-HTTPS URL.");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof SalesforceLauncherError) throw error;
    throw new SalesforceLauncherError("UNSAFE_URL", "Salesforce CLI returned a malformed URL.", { cause: error });
  }
}

function validateDestinationPath(path: string): string {
  const destination = path.trim();
  if (!destination.startsWith("/") || destination.startsWith("//") || destination.includes("\0")) {
    throw new SalesforceLauncherError("INVALID_DESTINATION", "Salesforce destination must be an absolute URL path.");
  }
  return destination;
}

function mapCliError(error: unknown): SalesforceLauncherError {
  if (error instanceof SalesforceLauncherError) return error;

  if (error instanceof ExecutableError) {
    if (error.timedOut) {
      return new SalesforceLauncherError("CLI_TIMEOUT", "Salesforce CLI took too long to respond.");
    }

    const message = extractCliErrorMessage(error.stdout, error.stderr);
    if (/(SecKeychain|Keychain|Unable to obtain authorization for this operation)/i.test(message)) {
      return new SalesforceLauncherError("KEYCHAIN_ACCESS_DENIED", message);
    }
    const looksLikeAuthFailure = /auth|expired|refresh token|authorization|login/i.test(message);
    return new SalesforceLauncherError(looksLikeAuthFailure ? "CLI_AUTH_FAILED" : "CLI_FAILED", message);
  }

  return new SalesforceLauncherError(
    "CLI_FAILED",
    error instanceof Error ? sanitizeUserFacingMessage(error.message) : "Salesforce CLI command failed.",
    { cause: error },
  );
}

function extractCliErrorMessage(stdout: string, stderr: string): string {
  for (const output of [stdout, stderr]) {
    try {
      const parsed = JSON.parse(output.trim()) as unknown;
      if (isRecord(parsed)) return readSafeMessage(parsed);
    } catch {
      // Fall back to sanitized plain text below.
    }
  }

  return sanitizeUserFacingMessage(stderr || stdout || "Salesforce CLI command failed.");
}

function readSafeMessage(record: Record<string, unknown>): string {
  const candidates = [record.message, isRecord(record.result) ? record.result.message : undefined, record.name];
  const message = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return sanitizeUserFacingMessage(message ?? "Salesforce CLI command failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
