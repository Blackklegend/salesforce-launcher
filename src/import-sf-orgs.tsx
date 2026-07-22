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
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useMemo, useState } from "react";

import {
  AuthTransferResult,
  discoverImportableAuthFiles,
  ImportableAuthFile,
  importOrgAuthFiles,
  importSfdxAuthUrls,
  parseLocalImportLocations,
  parseSfdxAuthUrls,
} from "./services/org-auth-transfer";
import { getErrorPresentation } from "./utils/errors";

interface ImportValues {
  inputLocations: string[];
  pastedLocation: string;
  authUrl: string;
  deleteAfterImport: boolean;
}

export default function Command() {
  const [isLoading, setIsLoading] = useState(false);
  const [deleteAfterImport, setDeleteAfterImport] = useState(false);
  const { push } = useNavigation();

  async function submit(values: ImportValues) {
    try {
      const locations = [...values.inputLocations, ...parseLocalImportLocations(values.pastedLocation)];
      await reviewImport(locations, parseSfdxAuthUrls(values.authUrl), values.deleteAfterImport);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Invalid import location",
        message: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function importFromClipboard() {
    const clipboard = await Clipboard.read();
    try {
      const isAuthUrl = !clipboard.file && clipboard.text.trim().startsWith("force://");
      const locations = clipboard.file
        ? [String(clipboard.file)]
        : isAuthUrl
          ? []
          : parseLocalImportLocations(clipboard.text);
      const authUrls = isAuthUrl ? parseSfdxAuthUrls(clipboard.text) : [];
      await reviewImport(locations, authUrls, deleteAfterImport);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Clipboard does not contain a local import path",
        message: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function reviewImport(locations: string[], authUrls: string[], deleteFiles: boolean) {
    if (locations.length === 0 && authUrls.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Choose a file or paste a local path or SFDX auth URL",
      });
      return;
    }

    setIsLoading(true);
    try {
      const authFiles = locations.length > 0 ? await discoverImportableAuthFiles(locations) : [];
      if (authFiles.length === 0 && authUrls.length === 0) {
        await showToast({ style: Toast.Style.Failure, title: "No .authurl credential files found" });
        return;
      }
      push(<ImportSelectionList authFiles={authFiles} authUrls={authUrls} deleteAfterImport={deleteFiles} />);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not read import source",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Review Credentials" icon={Icon.List} onSubmit={submit} />
          <Action title="Import from Clipboard" icon={Icon.Clipboard} onAction={importFromClipboard} />
        </ActionPanel>
      }
    >
      <Form.Description text="Choose files or folders, paste an absolute path or file:// link, or copy a file in Finder and use Import from Clipboard. Matching .alias files restore org aliases." />
      <Form.FilePicker
        id="inputLocations"
        title="Files or Folders"
        allowMultipleSelection
        canChooseDirectories
        canChooseFiles
      />
      <Form.TextField
        id="pastedLocation"
        title="Path or File Link"
        placeholder="/path/to/export or file:///path/to/org.authurl"
      />
      <Form.PasswordField
        id="authUrl"
        title="SFDX Auth URL"
        placeholder="force://…"
        info="Imported through a temporary owner-only file that is deleted immediately."
      />
      <Form.Checkbox
        id="deleteAfterImport"
        title="Cleanup"
        label="Permanently delete credential files after each successful import"
        value={deleteAfterImport}
        onChange={setDeleteAfterImport}
      />
    </Form>
  );
}

interface ImportCandidate {
  key: string;
  title: string;
  subtitle?: string;
  keywords: string[];
  authFile?: ImportableAuthFile;
  authUrl?: string;
}

function ImportSelectionList({
  authFiles,
  authUrls,
  deleteAfterImport,
}: {
  authFiles: ImportableAuthFile[];
  authUrls: string[];
  deleteAfterImport: boolean;
}) {
  const candidates = useMemo<ImportCandidate[]>(
    () => [
      ...authFiles.map((authFile) => ({
        key: `file:${authFile.path}`,
        title: authFile.alias || authFile.name,
        subtitle: authFile.alias ? authFile.name : undefined,
        keywords: [authFile.name, authFile.path, authFile.alias].filter((value): value is string => Boolean(value)),
        authFile,
      })),
      ...authUrls.map((authUrl, index) => ({
        key: `url:${index}`,
        title: `Pasted credential ${index + 1}`,
        subtitle: "SFDX auth URL",
        keywords: ["pasted", "credential", "SFDX auth URL"],
        authUrl,
      })),
    ],
    [authFiles, authUrls],
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(candidates.map((candidate) => candidate.key)));
  const [isLoading, setIsLoading] = useState(false);
  const selectedCandidates = candidates.filter((candidate) => selectedKeys.has(candidate.key));

  function toggleCandidate(candidate: ImportCandidate) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(candidate.key)) next.delete(candidate.key);
      else next.add(candidate.key);
      return next;
    });
  }

  async function performImport() {
    if (selectedCandidates.length === 0) return;
    const confirmed = await confirmAlert({
      title: deleteAfterImport ? "Import and delete selected credentials?" : "Import selected credentials?",
      message: deleteAfterImport
        ? "Successfully imported .authurl and .alias files will be permanently deleted. Failed imports will be kept."
        : "Salesforce CLI will store each credential in its normal secure authentication store.",
      primaryAction: {
        title: deleteAfterImport ? "Import and Delete" : "Import Credentials",
        style: deleteAfterImport ? Alert.ActionStyle.Destructive : Alert.ActionStyle.Default,
      },
    });
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const result = emptyResult();
      const selectedFiles = selectedCandidates.flatMap((candidate) =>
        candidate.authFile ? [candidate.authFile.path] : [],
      );
      const selectedUrls = selectedCandidates.flatMap((candidate) => (candidate.authUrl ? [candidate.authUrl] : []));
      if (selectedFiles.length > 0) mergeResult(result, await importOrgAuthFiles(selectedFiles, { deleteAfterImport }));
      if (selectedUrls.length > 0) mergeResult(result, await importSfdxAuthUrls(selectedUrls));
      await showImportResult(result);
    } catch (error) {
      const presentation = getErrorPresentation(error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not import orgs",
        message: presentation.message ?? presentation.title,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Select Credentials to Import"
      searchBarPlaceholder="Search alias, file, or path…"
    >
      <List.Section title="Credentials" subtitle={`${selectedCandidates.length} of ${candidates.length} selected`}>
        {candidates.map((candidate) => {
          const selected = selectedKeys.has(candidate.key);
          return (
            <List.Item
              key={candidate.key}
              id={candidate.key}
              icon={{
                source: selected ? Icon.CheckCircle : Icon.Circle,
                tintColor: selected ? Color.Green : Color.SecondaryText,
              }}
              title={candidate.title}
              subtitle={candidate.subtitle}
              keywords={candidate.keywords}
              accessories={candidate.authUrl ? [{ tag: "Pasted" }] : undefined}
              actions={
                <ActionPanel>
                  <Action
                    title={selected ? "Deselect Credential" : "Select Credential"}
                    icon={selected ? Icon.Circle : Icon.CheckCircle}
                    onAction={() => toggleCandidate(candidate)}
                  />
                  {selectedCandidates.length > 0 ? (
                    <Action
                      title={`Import ${selectedCandidates.length} ${selectedCandidates.length === 1 ? "Credential" : "Credentials"}`}
                      icon={Icon.Upload}
                      onAction={performImport}
                    />
                  ) : null}
                  <Action
                    title="Select All Credentials"
                    icon={Icon.Checkmark}
                    onAction={() => setSelectedKeys(new Set(candidates.map((item) => item.key)))}
                  />
                  <Action
                    title="Deselect All Credentials"
                    icon={Icon.XMarkCircle}
                    onAction={() => setSelectedKeys(new Set())}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}

async function showImportResult(result: AuthTransferResult) {
  const details = [
    result.failures.length > 0 ? `Failed: ${result.failures.join(", ")}` : undefined,
    result.cleanupFailed ? `${result.cleanupFailed} cleanup failed` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  await showToast({
    style: result.succeeded > 0 ? Toast.Style.Success : Toast.Style.Failure,
    title: `Imported ${result.succeeded} ${result.succeeded === 1 ? "org" : "orgs"}`,
    message: details || undefined,
  });
}

function emptyResult(): AuthTransferResult {
  return { succeeded: 0, skipped: 0, cleanupFailed: 0, failures: [] };
}

function mergeResult(target: AuthTransferResult, source: AuthTransferResult): void {
  target.succeeded += source.succeeded;
  target.skipped += source.skipped;
  target.cleanupFailed += source.cleanupFailed;
  target.failures.push(...source.failures);
}
