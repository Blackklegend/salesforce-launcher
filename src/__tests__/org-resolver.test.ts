import { describe, expect, it } from "vitest";

import { SalesforceOrg } from "../models/salesforce-org";
import { resolveOrg } from "../services/org-resolver";

const ORGS = [
  org("dev", ["customer-dev", "cust-dev"], "dev@example.com"),
  org("uat", ["customer-uat"], "uat@example.com"),
  org("prod", ["customer-prod"], "prod@example.com"),
];

describe("resolveOrg", () => {
  it("matches exact aliases case-insensitively", () => {
    expect(resolveOrg("  CUSTOMER-DEV  ", ORGS)).toMatchObject({ type: "resolved", org: { key: "dev" } });
  });

  it("matches an exact username", () => {
    expect(resolveOrg("uat@example.com", ORGS)).toMatchObject({ type: "resolved", org: { key: "uat" } });
  });

  it("prefers an exact alias over an exact username on another org", () => {
    const orgs = [org("alias", ["shared@example.com"], "other@example.com"), org("username", [], "shared@example.com")];
    expect(resolveOrg("shared@example.com", orgs)).toMatchObject({ type: "resolved", org: { key: "alias" } });
  });

  it("resolves unique alias and username prefixes", () => {
    expect(resolveOrg("customer-d", ORGS)).toMatchObject({ type: "resolved", org: { key: "dev" } });
    expect(resolveOrg("prod@", ORGS)).toMatchObject({ type: "resolved", org: { key: "prod" } });
  });

  it("resolves a unique substring across every alias and username", () => {
    expect(resolveOrg("cust-dev", ORGS)).toMatchObject({ type: "resolved", org: { key: "dev" } });
    expect(resolveOrg("uat@", ORGS)).toMatchObject({ type: "resolved", org: { key: "uat" } });
  });

  it("reports ambiguous prefixes and substrings", () => {
    expect(resolveOrg("customer", ORGS)).toMatchObject({ type: "ambiguous", matches: ORGS });
    expect(resolveOrg("example", ORGS)).toMatchObject({ type: "ambiguous", matches: ORGS });
  });

  it("reports duplicate exact aliases as ambiguous", () => {
    const result = resolveOrg("duplicate", [
      org("one", ["duplicate"], "one@example.com"),
      org("two", ["duplicate"], "two@example.com"),
    ]);
    expect(result).toMatchObject({ type: "ambiguous" });
  });

  it("deduplicates the same org before deciding ambiguity", () => {
    const duplicate = org("same", ["needle"], "needle@example.com");
    expect(resolveOrg("needle", [duplicate, { ...duplicate }])).toMatchObject({
      type: "resolved",
      org: { key: "same" },
    });
  });

  it("returns not-found for empty and unknown queries", () => {
    expect(resolveOrg("   ", ORGS)).toEqual({ type: "not-found", query: "" });
    expect(resolveOrg("missing", ORGS)).toEqual({ type: "not-found", query: "missing" });
  });
});

function org(key: string, aliases: string[], username?: string): SalesforceOrg {
  return {
    key,
    aliases,
    username,
    isDefaultOrg: false,
    isDefaultDevHub: false,
    isDevHub: false,
    isScratchOrg: false,
  };
}
