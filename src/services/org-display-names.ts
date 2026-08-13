import { LocalStorage } from "@raycast/api";

const DISPLAY_NAMES_KEY = "org-display-names-v1";
const MAX_DISPLAY_NAME_LENGTH = 120;

export type OrgDisplayNames = Record<string, string>;

export async function readOrgDisplayNames(): Promise<OrgDisplayNames> {
  try {
    const serialized = await LocalStorage.getItem<string>(DISPLAY_NAMES_KEY);
    if (!serialized) return {};
    return parseDisplayNames(JSON.parse(serialized) as unknown);
  } catch {
    try {
      await LocalStorage.removeItem(DISPLAY_NAMES_KEY);
    } catch {
      // Invalid custom names should never prevent the org list from loading.
    }
    return {};
  }
}

export async function writeOrgDisplayNames(displayNames: OrgDisplayNames): Promise<void> {
  const normalized = parseDisplayNames(displayNames);
  if (Object.keys(normalized).length === 0) {
    await LocalStorage.removeItem(DISPLAY_NAMES_KEY);
    return;
  }

  await LocalStorage.setItem(DISPLAY_NAMES_KEY, JSON.stringify(normalized));
}

export function normalizeOrgDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function parseDisplayNames(value: unknown): OrgDisplayNames {
  if (!isRecord(value)) throw new Error("Invalid org display names");

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, name]) => {
      if (!key || typeof name !== "string") return [];
      const normalized = normalizeOrgDisplayName(name);
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
