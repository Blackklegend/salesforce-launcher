export type SalesforceLauncherErrorCode =
  | "CLI_NOT_FOUND"
  | "CONFIGURED_CLI_INVALID"
  | "CLI_TIMEOUT"
  | "KEYCHAIN_ACCESS_DENIED"
  | "CLI_FAILED"
  | "CLI_AUTH_FAILED"
  | "INVALID_CLI_JSON"
  | "INVALID_CLI_RESPONSE"
  | "INVALID_DESTINATION"
  | "UNSAFE_URL";

export class SalesforceLauncherError extends Error {
  constructor(
    readonly code: SalesforceLauncherErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SalesforceLauncherError";
  }
}

export interface ErrorPresentation {
  title: string;
  message?: string;
}

export function getErrorPresentation(error: unknown): ErrorPresentation {
  if (error instanceof SalesforceLauncherError) {
    switch (error.code) {
      case "CLI_NOT_FOUND":
        return {
          title: "Salesforce CLI was not found",
          message: "Install it or configure its absolute path in extension preferences.",
        };
      case "CONFIGURED_CLI_INVALID":
        return {
          title: "Salesforce CLI path is invalid",
          message: "Choose an existing executable in extension preferences.",
        };
      case "CLI_TIMEOUT":
        return {
          title: "Salesforce CLI took too long to respond",
          message: "Try again or check the CLI from Terminal.",
        };
      case "KEYCHAIN_ACCESS_DENIED":
        return {
          title: "Salesforce CLI could not access macOS Keychain",
          message: "Allow the Keychain prompt for Raycast, then refresh your orgs.",
        };
      case "CLI_AUTH_FAILED":
        return {
          title: "Salesforce authorization may have expired",
          message: error.message,
        };
      case "INVALID_CLI_JSON":
      case "INVALID_CLI_RESPONSE":
        return {
          title: "Salesforce CLI returned an unexpected response",
          message: "Update Salesforce CLI and try again.",
        };
      case "INVALID_DESTINATION":
      case "UNSAFE_URL":
        return {
          title: "Salesforce returned an unsafe URL",
          message: "The org was not opened.",
        };
      case "CLI_FAILED":
        return {
          title: "Salesforce CLI command failed",
          message: error.message,
        };
    }
  }

  return {
    title: "Could not open Salesforce org",
    message: error instanceof Error ? sanitizeUserFacingMessage(error.message) : "An unexpected error occurred.",
  };
}

export function sanitizeUserFacingMessage(message: string): string {
  const firstLine = message.trim().split(/\r?\n/, 1)[0] ?? "";
  const withoutUrls = firstLine.replace(/https:\/\/[^\s"'<>]+/gi, "[Salesforce URL]");
  const withoutTokens = withoutUrls
    .replace(/00D[A-Za-z0-9]{12,15}![.A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/sid=[^&\s"'<>]+/gi, "sid=[redacted]");
  return withoutTokens.slice(0, 240) || "An unexpected error occurred.";
}
