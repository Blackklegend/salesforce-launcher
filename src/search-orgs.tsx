import {
  Action,
  ActionPanel,
  closeMainWindow,
  Color,
  Form,
  getPreferenceValues,
  Icon,
  Keyboard,
  LaunchProps,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SalesforceOrg, getOrgLabel, getPrimaryAlias } from "./models/salesforce-org";
import {
  classifyOrg,
  EnvironmentSectionOrder,
  getOrgSectionOrder,
  getOrgTypeLabel,
  OrgSection,
} from "./services/org-classifier";
import {
  normalizeOrgDisplayName,
  OrgDisplayNames,
  readOrgDisplayNames,
  writeOrgDisplayNames,
} from "./services/org-display-names";
import { listAuthenticatedOrgs, openSalesforceOrg, openSalesforceOrgPrivately } from "./services/org-service";
import { getErrorPresentation } from "./utils/errors";

const SETUP_PATH = "/lightning/setup/SetupOneHome/home";

interface SearchOrgPreferences {
  environmentSectionOrder?: EnvironmentSectionOrder;
}

export default function Command(props: LaunchProps) {
  const preferences = getPreferenceValues<SearchOrgPreferences>();
  const [orgs, setOrgs] = useState<SalesforceOrg[]>([]);
  const [displayNames, setDisplayNames] = useState<OrgDisplayNames>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [searchText, setSearchText] = useState(props.fallbackText ?? "");
  const latestRequest = useRef(0);
  const displayNamesRef = useRef<OrgDisplayNames>({});

  const loadOrgs = useCallback(async (options: LoadOptions = {}) => {
    const requestId = ++latestRequest.current;
    setIsLoading(true);

    try {
      const result = await listAuthenticatedOrgs({
        forceRefresh: options.forceRefresh,
        allowStaleCache: options.allowStaleCache,
      });
      if (requestId !== latestRequest.current) return undefined;

      setOrgs(result.orgs);
      setLoadError(undefined);

      if (options.showSuccess) {
        await showToast({
          style: Toast.Style.Success,
          title: "Salesforce orgs refreshed",
          message: `${result.orgs.length} ${result.orgs.length === 1 ? "org" : "orgs"}`,
        });
      }
      return result;
    } catch (error) {
      if (requestId !== latestRequest.current) return undefined;

      setLoadError(error);
      const presentation = getErrorPresentation(error);

      if (options.forceRefresh) {
        await showToast({
          style: Toast.Style.Failure,
          title: presentation.title,
          message: presentation.message,
          primaryAction: {
            title: "Open Extension Preferences",
            onAction: openExtensionPreferences,
          },
        });
      }
      return undefined;
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const initial = await loadOrgs({ allowStaleCache: true });
      if (initial?.isStale) await loadOrgs({ forceRefresh: true });
    })();
  }, [loadOrgs]);

  useEffect(() => {
    void readOrgDisplayNames().then((names) => {
      displayNamesRef.current = names;
      setDisplayNames(names);
    });
  }, []);

  const updateDisplayName = useCallback(async (orgKey: string, displayName?: string) => {
    const next = { ...displayNamesRef.current };
    const normalized = displayName ? normalizeOrgDisplayName(displayName) : "";
    if (normalized) next[orgKey] = normalized;
    else delete next[orgKey];

    await writeOrgDisplayNames(next);
    displayNamesRef.current = next;
    setDisplayNames(next);
  }, []);

  const sections = useMemo(() => groupOrgs(orgs, displayNames), [displayNames, orgs]);
  const sectionOrder = getOrgSectionOrder(preferences.environmentSectionOrder ?? "sandboxes-first");

  const emptyView = createEmptyView({
    loadError,
    isLoading,
    hasOrgs: orgs.length > 0,
    refresh: () => loadOrgs({ forceRefresh: true, showSuccess: true }).then(() => undefined),
  });

  return (
    <List
      isLoading={isLoading}
      filtering={{ keepSectionOrder: true }}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search alias, username, org ID, URL, or type…"
    >
      {emptyView}
      {sectionOrder.map((section) => {
        const sectionOrgs = sections.get(section) ?? [];
        if (sectionOrgs.length === 0) return null;

        return (
          <List.Section key={section} title={section} subtitle={`${sectionOrgs.length}`}>
            {sectionOrgs.map((org) => (
              <OrgListItem
                key={org.key}
                org={org}
                customDisplayName={displayNames[org.key]}
                updateDisplayName={(displayName) => updateDisplayName(org.key, displayName)}
                refresh={() => loadOrgs({ forceRefresh: true, showSuccess: true }).then(() => undefined)}
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}

interface LoadOptions {
  forceRefresh?: boolean;
  allowStaleCache?: boolean;
  showSuccess?: boolean;
}

function OrgListItem({
  org,
  customDisplayName,
  updateDisplayName,
  refresh,
}: {
  org: SalesforceOrg;
  customDisplayName?: string;
  updateDisplayName: (displayName?: string) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const label = customDisplayName ?? getOrgLabel(org);
  const primaryAlias = getPrimaryAlias(org);
  const metadata = [
    customDisplayName && primaryAlias ? `Salesforce alias: ${primaryAlias}` : undefined,
    org.aliases.length > 1 ? `Aliases: ${org.aliases.join(", ")}` : undefined,
    org.orgId ? `Org ID: ${org.orgId}` : undefined,
    org.instanceUrl,
  ].filter(Boolean);

  return (
    <List.Item
      id={org.key}
      icon={getOrgIcon(org)}
      title={{ value: label, tooltip: metadata.join("\n") || undefined }}
      subtitle={org.username && org.username !== label ? org.username : undefined}
      keywords={getSearchKeywords(org, customDisplayName)}
      accessories={getAccessories(org)}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action title="Open Org" icon={Icon.Globe} onAction={() => performOpen(org, { displayName: label })} />
            <Action
              title="Open Org in Private Window"
              icon={Icon.Mask}
              shortcut={{
                macOS: { modifiers: ["cmd", "shift"], key: "p" },
                Windows: { modifiers: ["ctrl", "shift"], key: "p" },
              }}
              onAction={() => performOpen(org, { displayName: label, privateWindow: true })}
            />
            <Action
              title="Open Setup"
              icon={Icon.Gear}
              shortcut={Keyboard.Shortcut.Common.Open}
              onAction={() => performOpen(org, { displayName: label, path: SETUP_PATH })}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Customize">
            <Action.Push
              title="Rename Display Name"
              icon={Icon.Pencil}
              target={<RenameOrgForm org={org} initialName={label} updateDisplayName={updateDisplayName} />}
            />
            {customDisplayName ? (
              <Action
                title="Reset Display Name"
                icon={Icon.Undo}
                onAction={async () => {
                  await updateDisplayName();
                  await showToast({ style: Toast.Style.Success, title: "Display name reset" });
                }}
              />
            ) : null}
          </ActionPanel.Section>

          <ActionPanel.Section title="Copy">
            {org.aliases.map((alias, index) => (
              <Action.CopyToClipboard
                key={alias}
                title={index === 0 ? "Copy Alias" : `Copy Alias “${alias}”`}
                content={alias}
                shortcut={index === 0 ? Keyboard.Shortcut.Common.Copy : undefined}
              />
            ))}
            {org.username ? (
              <Action.CopyToClipboard
                title="Copy Username"
                content={org.username}
                shortcut={!primaryAlias ? Keyboard.Shortcut.Common.Copy : undefined}
              />
            ) : null}
            {org.orgId ? <Action.CopyToClipboard title="Copy Org ID" content={org.orgId} /> : null}
            {org.instanceUrl ? <Action.CopyToClipboard title="Copy Instance URL" content={org.instanceUrl} /> : null}
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title="Refresh Orgs"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={refresh}
            />
            <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

async function performOpen(
  org: SalesforceOrg,
  options: { displayName?: string; path?: string; privateWindow?: boolean } = {},
): Promise<void> {
  const label = options.displayName ?? getOrgLabel(org);
  const destination = options.path ? "Setup" : label;
  const toast = await showToast({ style: Toast.Style.Animated, title: `Opening ${destination}` });

  try {
    if (options.privateWindow) {
      await openSalesforceOrgPrivately(org, options.path);
    } else {
      await openSalesforceOrg(org, options.path);
    }

    toast.style = Toast.Style.Success;
    toast.title = `Opened ${destination}`;
    await closeMainWindow({ clearRootSearch: true });
  } catch (error) {
    const presentation = getErrorPresentation(error);
    toast.style = Toast.Style.Failure;
    toast.title = presentation.title;
    toast.message = presentation.message;
    toast.primaryAction = {
      title: "Open Extension Preferences",
      onAction: openExtensionPreferences,
    };
  }
}

function RenameOrgForm({
  org,
  initialName,
  updateDisplayName,
}: {
  org: SalesforceOrg;
  initialName: string;
  updateDisplayName: (displayName: string) => Promise<void>;
}) {
  const { pop } = useNavigation();
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  async function submit(values: { displayName: string }) {
    const displayName = normalizeOrgDisplayName(values.displayName);
    if (!displayName) {
      setError("Enter a display name");
      return;
    }

    setIsSaving(true);
    try {
      await updateDisplayName(displayName);
      await showToast({ style: Toast.Style.Success, title: `Renamed to ${displayName}` });
      pop();
    } catch (saveError) {
      const presentation = getErrorPresentation(saveError);
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not rename org",
        message: presentation.message ?? presentation.title,
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      navigationTitle={`Rename ${getOrgLabel(org)}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Display Name" icon={Icon.Pencil} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description text="This changes only the name shown in SF Orgs. The Salesforce CLI alias and login target stay unchanged." />
      <Form.TextField
        id="displayName"
        title="Display Name"
        defaultValue={initialName}
        error={error}
        onChange={() => setError(undefined)}
      />
    </Form>
  );
}

function groupOrgs(orgs: SalesforceOrg[], displayNames: OrgDisplayNames): Map<OrgSection, SalesforceOrg[]> {
  const sections = new Map<OrgSection, SalesforceOrg[]>();

  for (const org of [...orgs].sort((left, right) => compareOrgs(left, right, displayNames))) {
    const section = classifyOrg(org);
    sections.set(section, [...(sections.get(section) ?? []), org]);
  }

  return sections;
}

function compareOrgs(left: SalesforceOrg, right: SalesforceOrg, displayNames: OrgDisplayNames): number {
  return getDisplayLabel(left, displayNames).localeCompare(getDisplayLabel(right, displayNames), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function getDisplayLabel(org: SalesforceOrg, displayNames: OrgDisplayNames): string {
  return displayNames[org.key] ?? getOrgLabel(org);
}

function getSearchKeywords(org: SalesforceOrg, customDisplayName?: string): string[] {
  return [
    customDisplayName,
    ...org.aliases,
    org.username,
    org.orgId,
    org.instanceUrl,
    org.oauthMethod,
    getOrgTypeLabel(org),
    org.isDevHub ? "dev hub devhub" : undefined,
    org.isDefaultOrg ? "default" : undefined,
    org.isExpired ? "expired stale" : undefined,
    org.authorizationError ? "auth error stale" : undefined,
  ].filter((value): value is string => Boolean(value));
}

function getAccessories(org: SalesforceOrg): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (org.isExpired || org.authorizationError) {
    accessories.push({
      icon: { source: Icon.ExclamationMark, tintColor: Color.Red },
      text: { value: org.isExpired ? "Expired" : "Auth Error", color: Color.Red },
      tooltip: org.authorizationError ?? "This scratch-org authorization is expired",
    });
  }

  if (org.isDefaultOrg) {
    accessories.push({ icon: Icon.Star, text: "Default", tooltip: "Default target org" });
  } else if (org.isDefaultDevHub) {
    accessories.push({ icon: Icon.Star, text: "Default Dev Hub", tooltip: "Default target Dev Hub" });
  }

  const type = getOrgTypeLabel(org);
  if (type) accessories.push({ text: type });

  if (org.isDevHub && accessories.length < 3) {
    accessories.push({ icon: Icon.Terminal, text: "Dev Hub" });
  }

  return accessories.slice(0, 3);
}

function getOrgIcon(org: SalesforceOrg) {
  if (org.authorizationError || org.isExpired) return { source: Icon.Cloud, tintColor: Color.Red };
  if (org.isScratchOrg) return { source: Icon.Hammer, tintColor: Color.Orange };
  if (org.isSandbox === true) return { source: Icon.Box, tintColor: Color.Blue };
  if (org.isDevHub) return { source: Icon.Terminal, tintColor: Color.Purple };
  return { source: Icon.Cloud, tintColor: Color.PrimaryText };
}

function createEmptyView({
  loadError,
  isLoading,
  hasOrgs,
  refresh,
}: {
  loadError: unknown;
  isLoading: boolean;
  hasOrgs: boolean;
  refresh: () => Promise<void>;
}) {
  if (isLoading) return null;

  const presentation = loadError ? getErrorPresentation(loadError) : undefined;
  return (
    <List.EmptyView
      icon={loadError ? Icon.ExclamationMark : Icon.Cloud}
      title={
        presentation?.title ?? (hasOrgs ? "No matching Salesforce orgs" : "No authenticated Salesforce orgs found")
      }
      description={
        presentation?.message ??
        (hasOrgs
          ? "Try a different alias, username, org ID, URL, or type."
          : "Authenticate one with sf org login web, then refresh this list.")
      }
      actions={
        <ActionPanel>
          <Action title="Refresh Orgs" icon={Icon.ArrowClockwise} onAction={refresh} />
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
