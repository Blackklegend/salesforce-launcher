import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(async (key: string) => storage.get(key)),
    setItem: vi.fn(async (key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => storage.delete(key)),
  },
}));

import { SalesforceOrg } from "../models/salesforce-org";
import { ORG_CACHE_TTL_MS, readAuthenticatedOrgCache, writeAuthenticatedOrgCache } from "../services/org-cache";

const ORG: SalesforceOrg = {
  key: "00D:user@example.com",
  aliases: ["dev"],
  username: "user@example.com",
  isDefaultOrg: false,
  isDefaultDevHub: false,
  isDevHub: false,
  isScratchOrg: false,
};

describe("authenticated org cache", () => {
  beforeEach(() => storage.clear());

  it("returns fresh safe data for the same CLI path", async () => {
    await writeAuthenticatedOrgCache("/bin/sf", [ORG], 1_000);
    await expect(readAuthenticatedOrgCache("/bin/sf", { now: 1_001 })).resolves.toEqual([ORG]);
  });

  it("invalidates on age and CLI path changes", async () => {
    await writeAuthenticatedOrgCache("/bin/sf", [ORG], 1_000);
    await expect(readAuthenticatedOrgCache("/other/sf", { now: 1_001 })).resolves.toBeUndefined();
    await expect(readAuthenticatedOrgCache("/bin/sf", { now: 1_000 + ORG_CACHE_TTL_MS + 1 })).resolves.toBeUndefined();
  });

  it("can return stale data explicitly for immediate rendering", async () => {
    await writeAuthenticatedOrgCache("/bin/sf", [ORG], 1_000);
    await expect(
      readAuthenticatedOrgCache("/bin/sf", { allowStale: true, now: 1_000 + ORG_CACHE_TTL_MS + 1 }),
    ).resolves.toEqual([ORG]);
  });

  it("whitelists persisted fields even if a caller supplies extra data", async () => {
    const orgWithUnexpectedSecret = { ...ORG, accessToken: "never-store-this" } as SalesforceOrg;
    await writeAuthenticatedOrgCache("/bin/sf", [orgWithUnexpectedSecret], 1_000);

    const serialized = [...storage.values()][0];
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("never-store-this");
  });
});
