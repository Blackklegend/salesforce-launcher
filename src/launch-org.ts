import { LaunchProps, showHUD } from "@raycast/api";

import { getOrgLabel } from "./models/salesforce-org";
import { resolveOrg } from "./services/org-resolver";
import { listAuthenticatedOrgs, openSalesforceOrg } from "./services/org-service";
import { getErrorPresentation } from "./utils/errors";

interface LaunchArguments {
  org: string;
}

export default async function Command(props: LaunchProps<{ arguments: LaunchArguments }>) {
  // Fallback commands receive Root Search text separately from manifest
  // arguments. Prefer it when present so typing an org alias at the root can
  // launch this command without first selecting it and filling its argument.
  const query = props.fallbackText?.trim() || props.arguments?.org?.trim() || "";

  if (!query) {
    await showHUD("Enter a Salesforce org alias or username");
    return;
  }

  try {
    let orgList = await listAuthenticatedOrgs();

    if (orgList.orgs.length === 0 && orgList.fromCache) {
      orgList = await listAuthenticatedOrgs({ forceRefresh: true });
    }

    if (orgList.orgs.length === 0) {
      await showHUD("No authenticated Salesforce orgs found — run sf org login web");
      return;
    }

    let resolution = resolveOrg(query, orgList.orgs);

    // A cached miss may simply mean the user authenticated or aliased an org in
    // the last few seconds. Refresh once before declaring failure.
    if (resolution.type !== "resolved" && orgList.fromCache) {
      orgList = await listAuthenticatedOrgs({ forceRefresh: true });
      resolution = resolveOrg(query, orgList.orgs);
    }

    if (resolution.type === "not-found") {
      await showHUD(`No authenticated org matches “${resolution.query}”`);
      return;
    }

    if (resolution.type === "ambiguous") {
      const labels = resolution.matches.slice(0, 5).map(getOrgLabel);
      const overflow =
        resolution.matches.length > labels.length ? ` +${resolution.matches.length - labels.length} more` : "";
      await showHUD(`“${resolution.query}” matches ${labels.join(", ")}${overflow} — type more or browse orgs`);
      return;
    }

    await openSalesforceOrg(resolution.org);
    await showHUD(`Opened ${getOrgLabel(resolution.org)}`, { clearRootSearch: true });
  } catch (error) {
    const presentation = getErrorPresentation(error);
    const message = presentation.message ? `${presentation.title} — ${presentation.message}` : presentation.title;
    await showHUD(message);
  }
}
