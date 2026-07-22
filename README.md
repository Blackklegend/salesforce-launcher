# SF Orgs

Open any Salesforce CLI-authenticated org from Raycast in a few keystrokes.

SF Orgs is deliberately small and local. It reads the authorizations already managed by Salesforce CLI, resolves aliases and usernames deterministically, and asks the CLI to generate each authenticated URL only when you open an org.

## The fast path

1. Assign a global hotkey to **Open Salesforce Org** in Raycast, for example <kbd>⌥</kbd> <kbd>S</kbd>.
2. Press the hotkey.
3. Type an alias such as `customer-dev`.
4. Press <kbd>Enter</kbd>.

Quick Open resolves, in order:

1. Exact alias
2. Exact username
3. Unique alias prefix
4. Unique username prefix
5. Unique substring across aliases and usernames

Matching is case-insensitive. Ambiguous input never opens the first result silently; SF Orgs asks you to type more or use the browse command.

## Launch from Raycast Root Search

Raycast can pass unmatched Root Search text directly to SF Orgs through its fallback-command feature:

1. Open **Raycast Settings → Launcher → Fallback Commands**.
2. Add **Open Salesforce Org** and move it near the top of the fallback list.
3. Type an org alias such as `defaultSandbox` in Root Search.
4. Select **Open Salesforce Org** and press <kbd>Enter</kbd>.

The command receives the entire Root Search query and applies the same safe, deterministic resolver described above. You can instead add **Browse Salesforce Orgs** as a fallback when you prefer to open a list already filtered to the typed text.

Raycast only runs an extension after you select its fallback row, so the fallback can be offered for an unknown or ambiguous alias too. SF Orgs handles those cases without opening anything. Raycast currently does not expose an extension API for injecting one dynamic Root Search row per locally authenticated org.

## Browse all orgs

Run **Browse Salesforce Orgs** to search local authorizations by:

- Every alias attached to an org
- Username
- Org ID
- Instance URL
- Authentication method
- Production, Sandbox, Scratch, Dev Hub, Default, or stale-auth labels

The primary action opens the selected org. The action panel also includes:

| Shortcut                               | Action                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| <kbd>Enter</kbd>                       | Open Org                                                 |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>P</kbd> | Open Org in Private Window                               |
| <kbd>⌘</kbd> <kbd>O</kbd>              | Open Setup                                               |
| <kbd>⌘</kbd> <kbd>C</kbd>              | Copy the primary alias, or username when no alias exists |
| <kbd>⌘</kbd> <kbd>R</kbd>              | Refresh Orgs                                             |

Copy actions for usernames, org IDs, instance URLs, and additional aliases appear only when those values exist.

## Requirements

- macOS
- [Raycast](https://www.raycast.com/)
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli)
- At least one locally authenticated Salesforce org

Authenticate an org and give it a memorable alias:

```bash
sf org login web --alias customer-dev
```

Confirm your local authorizations:

```bash
sf org list auth
```

## Salesforce CLI discovery

SF Orgs checks, in order:

1. The optional **Salesforce CLI Path** extension preference
2. Standard Apple Silicon and Intel Homebrew locations
3. Raycast's inherited `PATH`
4. Common Volta, asdf, mise, fnm, pnpm, and NVM installations

The NVM scan prefers the newest installed Node version, so a CLI at a path such as `~/.nvm/versions/node/v24.18.0/bin/sf` works even when Raycast receives a minimal `PATH`.
When launching the CLI, SF Orgs also prepends the executable's own directory to the child `PATH`, allowing NVM's `#!/usr/bin/env node` shim to find the matching Node binary without sourcing a shell profile.

If automatic discovery fails, open the extension preferences and enter the absolute path printed by:

```bash
which sf
```

## How it works

The normal list command is:

```bash
sf org list auth --json
```

This reads Salesforce CLI's local authorization cache and does not make a live request to every org. It is fast, but a stale authorization can still appear in the list and fail when opened.

For a regular launch, SF Orgs asks Salesforce CLI for a one-time authenticated URL:

```bash
sf org open --target-org <username> --url-only --json
```

Raycast opens the validated HTTPS URL. Setup uses the same flow with a Salesforce path. Private-window launches use Salesforce CLI's separate `--private` mode because that flag is mutually exclusive with `--url-only`.

Normalized org metadata is cached for 45 seconds in Raycast's local encrypted storage. Authenticated URLs, access tokens, raw CLI responses, and auth files are never cached or logged by the extension. CLI processes are launched without a shell and receive arguments as an array.
The extension disables Salesforce CLI telemetry, automatic update checks, and log-file output for its own short-lived child processes; it does not change your global CLI configuration.

## Troubleshooting

### Salesforce CLI was not found

Set **Salesforce CLI Path** in the extension preferences to the absolute result of `which sf`. This is most often needed for unusual Node-version-manager layouts.

### No orgs are listed

Run `sf org list auth` in Terminal. If it is empty, authenticate an org with `sf org login web --alias <alias>`, then use **Refresh Orgs**.

If Terminal sees orgs but Raycast reports a Keychain error, allow the macOS Keychain prompt for Raycast and refresh. Raycast and Terminal are separate host applications and can have different macOS permissions.

### An org appears but will not open

The local authorization may be stale. Reauthenticate it with Salesforce CLI and refresh the extension.

### An org has no alias

Search and launch it by username, or assign an alias through Salesforce CLI.

### Raycast and Terminal find different `sf` executables

Raycast does not always inherit an interactive shell's `PATH`. Set the extension preference explicitly to make both use the same binary.

## Development

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The test suite uses fixtures and mocked process execution. It never reads a developer's real Salesforce authorization data.

## Privacy

SF Orgs runs entirely on your Mac. It does not call Salesforce APIs directly, transmit org metadata to another service, display session IDs, or manage authentication. Salesforce CLI remains the authority for authentication and URL generation.
