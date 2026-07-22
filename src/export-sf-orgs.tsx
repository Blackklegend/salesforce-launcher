import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Color,
  confirmAlert,
  Form,
  Icon,
  List,
  showInFinder,
  showToast,
  Toast,
} from "@raycast/api";
import { join } from "node:path";
import { useEffect, useMemo, useState } from "react";

import { getOrgLabel, SalesforceOrg } from "./models/salesforce-org";
import { exportOrgAuthFiles } from "./services/org-auth-transfer";
import { listAuthenticatedOrgs } from "./services/org-service";
import { getErrorPresentation } from "./utils/errors";

interface ExportValues {
  parentDirectory: string[];
  folderName: string;
}

export default function Command() {
  const [orgs, setOrgs] = useState<SalesforceOrg[]>([]);
  const [selectedOrgKeys, setSelectedOrgKeys] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listAuthenticatedOrgs({ forceRefresh: true })
      .then(({ orgs: loadedOrgs }) => {
        if (!active) return;
        const exportableOrgs = loadedOrgs.filter((org) => org.username);
        setOrgs(exportableOrgs);
        setSelectedOrgKeys(new Set(exportableOrgs.filter((org) => !org.isScratchOrg).map((org) => org.key)));
      })
      .catch(async (error) => {
        if (!active) return;
        const presentation = getErrorPresentation(error);
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not load orgs",
          message: presentation.message ?? presentation.title,
        });
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedOrgs = useMemo(() => orgs.filter((org) => selectedOrgKeys.has(org.key)), [orgs, selectedOrgKeys]);
  const regularOrgs = orgs.filter((org) => !org.isScratchOrg);
  const scratchOrgs = orgs.filter((org) => org.isScratchOrg);

  function toggleOrg(org: SalesforceOrg) {
    setSelectedOrgKeys((current) => {
      const next = new Set(current);
      if (next.has(org.key)) next.delete(org.key);
      else next.add(org.key);
      return next;
    });
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search alias or username…">
      {!isLoading && orgs.length === 0 ? (
        <List.EmptyView title="No Exportable Orgs" description="No authenticated org has a usable username." />
      ) : null}
      <OrgSection
        title="Authenticated Orgs"
        orgs={regularOrgs}
        selectedOrgKeys={selectedOrgKeys}
        selectedOrgs={selectedOrgs}
        onToggle={toggleOrg}
        onSelectAll={() => setSelectedOrgKeys(new Set(orgs.map((org) => org.key)))}
        onDeselectAll={() => setSelectedOrgKeys(new Set())}
      />
      <OrgSection
        title="Scratch Orgs"
        orgs={scratchOrgs}
        selectedOrgKeys={selectedOrgKeys}
        selectedOrgs={selectedOrgs}
        onToggle={toggleOrg}
        onSelectAll={() => setSelectedOrgKeys(new Set(orgs.map((org) => org.key)))}
        onDeselectAll={() => setSelectedOrgKeys(new Set())}
      />
    </List>
  );
}

function OrgSection({
  title,
  orgs,
  selectedOrgKeys,
  selectedOrgs,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  title: string;
  orgs: SalesforceOrg[];
  selectedOrgKeys: Set<string>;
  selectedOrgs: SalesforceOrg[];
  onToggle: (org: SalesforceOrg) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  if (orgs.length === 0) return null;
  return (
    <List.Section title={title} subtitle={`${orgs.length}`}>
      {orgs.map((org) => {
        const selected = selectedOrgKeys.has(org.key);
        return (
          <List.Item
            key={org.key}
            id={org.key}
            icon={{
              source: selected ? Icon.CheckCircle : Icon.Circle,
              tintColor: selected ? Color.Green : Color.SecondaryText,
            }}
            title={getOrgLabel(org)}
            subtitle={org.username !== getOrgLabel(org) ? org.username : undefined}
            keywords={[...org.aliases, org.username].filter((value): value is string => Boolean(value))}
            accessories={org.isScratchOrg ? [{ tag: "Scratch" }] : undefined}
            actions={
              <ActionPanel>
                <Action
                  title={selected ? "Deselect Org" : "Select Org"}
                  icon={selected ? Icon.Circle : Icon.CheckCircle}
                  onAction={() => onToggle(org)}
                />
                {selectedOrgs.length > 0 ? (
                  <Action.Push
                    title={`Continue with ${selectedOrgs.length} ${selectedOrgs.length === 1 ? "Org" : "Orgs"}`}
                    icon={Icon.ArrowRight}
                    target={<ExportDestinationForm selectedOrgs={selectedOrgs} />}
                  />
                ) : null}
                <Action title="Select All Orgs" icon={Icon.Checkmark} onAction={onSelectAll} />
                <Action title="Deselect All Orgs" icon={Icon.XMarkCircle} onAction={onDeselectAll} />
              </ActionPanel>
            }
          />
        );
      })}
    </List.Section>
  );
}

function ExportDestinationForm({ selectedOrgs }: { selectedOrgs: SalesforceOrg[] }) {
  const [isLoading, setIsLoading] = useState(false);

  async function submit(values: ExportValues) {
    const parent = values.parentDirectory[0];
    const folderName = values.folderName.trim();
    if (!parent) {
      await showToast({ style: Toast.Style.Failure, title: "Choose a destination folder" });
      return;
    }
    if (
      !folderName ||
      folderName === "." ||
      folderName === ".." ||
      folderName.includes("/") ||
      folderName.includes("\0")
    ) {
      await showToast({ style: Toast.Style.Failure, title: "Enter a valid new folder name" });
      return;
    }

    const confirmed = await confirmAlert({
      title: `Export ${selectedOrgs.length} full-access ${selectedOrgs.length === 1 ? "credential" : "credentials"}?`,
      message:
        "Every .authurl file grants access to its Salesforce org. Store the folder securely, never commit or upload it, and delete it after migration.",
      primaryAction: { title: "Export Credentials", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const outputDirectory = join(parent, folderName);
    setIsLoading(true);
    try {
      const result = await exportOrgAuthFiles(selectedOrgs, outputDirectory, { includeScratch: true });
      await Clipboard.copy(outputDirectory);
      await showToast({
        style: result.succeeded > 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: `Exported ${result.succeeded} ${result.succeeded === 1 ? "org" : "orgs"}`,
        message: `${result.skipped ? `${result.skipped} skipped · ` : ""}Folder path copied`,
        primaryAction: { title: "Show Export Folder", onAction: () => showInFinder(outputDirectory) },
      });
    } catch (error) {
      const presentation = getErrorPresentation(error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not export orgs",
        message: presentation.message ?? presentation.title,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      navigationTitle={`Export ${selectedOrgs.length} ${selectedOrgs.length === 1 ? "Org" : "Orgs"}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Export Credentials" icon={Icon.Download} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Creates .authurl files containing full-access Salesforce credentials. The new folder is restricted to your macOS user (0700); each credential file uses 0600 permissions." />
      <Form.FilePicker
        id="parentDirectory"
        title="Save In"
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
      />
      <Form.TextField
        id="folderName"
        title="New Folder"
        defaultValue="sf-org-auth-export"
        placeholder="sf-org-auth-export"
      />
    </Form>
  );
}
