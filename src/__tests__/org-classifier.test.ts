import { describe, expect, it } from "vitest";

import { SalesforceOrg } from "../models/salesforce-org";
import { classifyOrg, getOrgSectionOrder } from "../services/org-classifier";

describe("classifyOrg", () => {
  it("uses deterministic precedence without guessing unknown production orgs", () => {
    expect(classifyOrg(org({ isDefaultOrg: true, isScratchOrg: true }))).toBe("Default");
    expect(classifyOrg(org({ isDefaultDevHub: true, isDevHub: true }))).toBe("Default");
    expect(classifyOrg(org({ isScratchOrg: true, isSandbox: true }))).toBe("Scratch Orgs");
    expect(classifyOrg(org({ isSandbox: true }))).toBe("Sandboxes");
    expect(classifyOrg(org({ isSandbox: false }))).toBe("Production");
    expect(classifyOrg(org({ isDevHub: true }))).toBe("Dev Hubs");
    expect(classifyOrg(org({}))).toBe("Other");
  });

  it("can place production before or after sandboxes", () => {
    expect(getOrgSectionOrder("sandboxes-first")).toEqual([
      "Default",
      "Scratch Orgs",
      "Sandboxes",
      "Production",
      "Dev Hubs",
      "Other",
    ]);
    expect(getOrgSectionOrder("production-first")).toEqual([
      "Default",
      "Scratch Orgs",
      "Production",
      "Sandboxes",
      "Dev Hubs",
      "Other",
    ]);
  });
});

function org(overrides: Partial<SalesforceOrg>): SalesforceOrg {
  return {
    key: "key",
    aliases: ["alias"],
    isDefaultOrg: false,
    isDefaultDevHub: false,
    isDevHub: false,
    isScratchOrg: false,
    ...overrides,
  };
}
