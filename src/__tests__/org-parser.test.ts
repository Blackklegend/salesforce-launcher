import { describe, expect, it } from "vitest";

import { SalesforceLauncherError } from "../utils/errors";
import { parseAuthenticatedOrgsResponse } from "../services/org-parser";

describe("parseAuthenticatedOrgsResponse", () => {
  it("normalizes the current auth-list shape and discards secrets", () => {
    const orgs = parseAuthenticatedOrgsResponse({
      status: 0,
      result: [
        {
          alias: "customer-dev,customer-sandbox",
          username: "developer@example.com.dev",
          orgId: "00D000000000001",
          instanceUrl: "https://customer--dev.sandbox.my.salesforce.com",
          accessToken: "00D000000000001!super-secret",
          configs: ["target-org", "target-dev-hub"],
          isScratchOrg: false,
          isDevHub: true,
          isSandbox: true,
          isExpired: "unknown",
          oauthMethod: "web",
        },
      ],
    });

    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      aliases: ["customer-dev", "customer-sandbox"],
      username: "developer@example.com.dev",
      orgId: "00D000000000001",
      isDefaultOrg: true,
      isDefaultDevHub: true,
      isDevHub: true,
      isScratchOrg: false,
      isSandbox: true,
      isExpired: undefined,
      oauthMethod: "web",
    });
    expect(JSON.stringify(orgs)).not.toContain("super-secret");
    expect(JSON.stringify(orgs)).not.toContain("accessToken");
  });

  it("accepts array aliases from other CLI versions", () => {
    const [org] = parseAuthenticatedOrgsResponse({
      status: 0,
      result: [{ aliases: ["one", "two", "one"], username: "user@example.com" }],
    });

    expect(org.aliases).toEqual(["one", "two"]);
  });

  it("accepts legacy bucketed results and infers their source type", () => {
    const orgs = parseAuthenticatedOrgsResponse({
      status: 0,
      result: {
        nonScratchOrgs: [{ alias: "production", username: "prod@example.com", isSandbox: false }],
        scratchOrgs: [{ alias: "feature-x", username: "scratch@example.com" }],
      },
    });

    expect(orgs).toHaveLength(2);
    expect(orgs.find((org) => org.aliases.includes("feature-x"))?.isScratchOrg).toBe(true);
  });

  it("ignores malformed entries without dropping valid orgs", () => {
    const orgs = parseAuthenticatedOrgsResponse({
      status: 0,
      result: [null, 42, {}, { alias: "usable" }],
    });

    expect(orgs).toHaveLength(1);
    expect(orgs[0].aliases).toEqual(["usable"]);
  });

  it("deduplicates equivalent authorizations and merges aliases", () => {
    const orgs = parseAuthenticatedOrgsResponse({
      status: 0,
      result: [
        { alias: "first", username: "same@example.com", orgId: "00Dsame", isDevHub: false },
        { alias: "second", username: "same@example.com", orgId: "00Dsame", isDevHub: true },
      ],
    });

    expect(orgs).toHaveLength(1);
    expect(orgs[0].aliases).toEqual(["first", "second"]);
    expect(orgs[0].isDevHub).toBe(true);
  });

  it("keeps separate usernames in the same org separate", () => {
    const orgs = parseAuthenticatedOrgsResponse({
      status: 0,
      result: [
        { username: "one@example.com", orgId: "00Dsame" },
        { username: "two@example.com", orgId: "00Dsame" },
      ],
    });

    expect(orgs).toHaveLength(2);
  });

  it("returns an empty list for a valid empty result", () => {
    expect(parseAuthenticatedOrgsResponse({ status: 0, result: [] })).toEqual([]);
  });

  it("distinguishes macOS Keychain denial from a genuinely empty auth list", () => {
    expect(() =>
      parseAuthenticatedOrgsResponse({
        status: 0,
        result: [],
        warnings: [
          "The auth file is invalid. Due to: security: SecKeychainItemCreateFromContent: Unable to obtain authorization for this operation.",
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "KEYCHAIN_ACCESS_DENIED" }));
  });

  it("rejects non-zero status and unexpected shapes", () => {
    expect(() => parseAuthenticatedOrgsResponse({ status: 1, message: "failed", result: [] })).toThrow(
      SalesforceLauncherError,
    );
    expect(() => parseAuthenticatedOrgsResponse({ status: 0, result: {} })).toThrow(SalesforceLauncherError);
    expect(() => parseAuthenticatedOrgsResponse({ status: 0, result: { orgs: {} } })).toThrow(SalesforceLauncherError);
    expect(() => parseAuthenticatedOrgsResponse(null)).toThrow(SalesforceLauncherError);
  });

  it("sanitizes authorization errors", () => {
    const [org] = parseAuthenticatedOrgsResponse({
      status: 0,
      result: [
        {
          alias: "stale",
          error: "Failed at https://example.my.salesforce.com/secur/frontdoor.jsp?sid=00D000000000001!secret",
        },
      ],
    });

    expect(org.authorizationError).toContain("[Salesforce URL]");
    expect(org.authorizationError).not.toContain("frontdoor");
    expect(org.authorizationError).not.toContain("secret");
  });
});
