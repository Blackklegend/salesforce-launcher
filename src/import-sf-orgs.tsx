import { Action, ActionPanel, Alert, Clipboard, confirmAlert, Form, Icon, showToast, Toast } from "@raycast/api";
import { useState } from "react";

import {
  AuthTransferResult,
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

  async function submit(values: ImportValues) {
    try {
      const locations = [...values.inputLocations, ...parseLocalImportLocations(values.pastedLocation)];
      await performImport(locations, parseSfdxAuthUrls(values.authUrl), values.deleteAfterImport);
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
      await performImport(locations, authUrls, deleteAfterImport);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Clipboard does not contain a local import path",
        message: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function performImport(locations: string[], authUrls: string[], deleteFiles: boolean) {
    if (locations.length === 0 && authUrls.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Choose a file or paste a local path or SFDX auth URL",
      });
      return;
    }

    const confirmed = await confirmAlert({
      title: deleteFiles ? "Import and delete credentials?" : "Import full-access credentials?",
      message: deleteFiles
        ? "Successfully imported .authurl and .alias files will be permanently deleted. Failed imports will be kept."
        : "Salesforce CLI will store each credential in its normal secure authentication store.",
      primaryAction: {
        title: deleteFiles ? "Import and Delete" : "Import Credentials",
        style: deleteFiles ? Alert.ActionStyle.Destructive : Alert.ActionStyle.Default,
      },
    });
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const result = emptyResult();
      if (locations.length > 0)
        mergeResult(result, await importOrgAuthFiles(locations, { deleteAfterImport: deleteFiles }));
      if (authUrls.length > 0) mergeResult(result, await importSfdxAuthUrls(authUrls));
      await showToast({
        style: result.succeeded > 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: `Imported ${result.succeeded} ${result.succeeded === 1 ? "org" : "orgs"}`,
        message:
          [
            result.skipped ? `${result.skipped} failed` : undefined,
            result.cleanupFailed ? `${result.cleanupFailed} cleanup failed` : undefined,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
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
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Import Credentials" icon={Icon.Upload} onSubmit={submit} />
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

function emptyResult(): AuthTransferResult {
  return { succeeded: 0, skipped: 0, cleanupFailed: 0, failures: [] };
}

function mergeResult(target: AuthTransferResult, source: AuthTransferResult): void {
  target.succeeded += source.succeeded;
  target.skipped += source.skipped;
  target.cleanupFailed += source.cleanupFailed;
  target.failures.push(...source.failures);
}
