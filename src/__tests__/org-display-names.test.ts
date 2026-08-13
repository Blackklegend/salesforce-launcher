import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(async (key: string) => storage.get(key)),
    setItem: vi.fn(async (key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => storage.delete(key)),
  },
}));

import { normalizeOrgDisplayName, readOrgDisplayNames, writeOrgDisplayNames } from "../services/org-display-names";

describe("org display names", () => {
  beforeEach(() => storage.clear());

  it("persists local names by stable org key", async () => {
    await writeOrgDisplayNames({ "00d:user@example.com": "Customer QA" });

    await expect(readOrgDisplayNames()).resolves.toEqual({ "00d:user@example.com": "Customer QA" });
  });

  it("normalizes whitespace and discards empty names", async () => {
    expect(normalizeOrgDisplayName("  Customer   QA  ")).toBe("Customer QA");
    await writeOrgDisplayNames({ keep: "  Customer   QA  ", remove: "   " });

    await expect(readOrgDisplayNames()).resolves.toEqual({ keep: "Customer QA" });
  });

  it("recovers from malformed storage", async () => {
    storage.set("org-display-names-v1", "not json");

    await expect(readOrgDisplayNames()).resolves.toEqual({});
    expect(storage.size).toBe(0);
  });
});
