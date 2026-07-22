import { SalesforceOrg } from "../models/salesforce-org";

export type OrgResolution =
  | { type: "resolved"; org: SalesforceOrg }
  | { type: "not-found"; query: string }
  | { type: "ambiguous"; query: string; matches: SalesforceOrg[] };

export function resolveOrg(query: string, orgs: SalesforceOrg[]): OrgResolution {
  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLocaleLowerCase();

  if (!needle) {
    return { type: "not-found", query: trimmedQuery };
  }

  const stages: Array<(org: SalesforceOrg) => boolean> = [
    (org) => org.aliases.some((alias) => normalize(alias) === needle),
    (org) => normalize(org.username) === needle,
    (org) => org.aliases.some((alias) => normalize(alias).startsWith(needle)),
    (org) => normalize(org.username).startsWith(needle),
    (org) => [...org.aliases, org.username].some((value) => normalize(value).includes(needle)),
  ];

  for (const matchesStage of stages) {
    const matches = deduplicate(orgs.filter(matchesStage));
    if (matches.length === 1) return { type: "resolved", org: matches[0] };
    if (matches.length > 1) return { type: "ambiguous", query: trimmedQuery, matches };
  }

  return { type: "not-found", query: trimmedQuery };
}

function deduplicate(orgs: SalesforceOrg[]): SalesforceOrg[] {
  return [...new Map(orgs.map((org) => [org.key, org])).values()];
}

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}
