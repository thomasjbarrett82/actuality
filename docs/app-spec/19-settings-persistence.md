# 19 — Settings & Persistence

Four scopes. None is an app database. Files are small JSON documents written atomically (temp file + rename; on Windows the rename is retried for about 0.4 s while antivirus or the search indexer holds the file) by the **main** process, with a `schemaVersion` and migrations. The renderer reads and writes through `shell.settings.*` and gets change notifications. A typed `useSettings()` composable exposes reactive values. The API host reads and writes the few keys it needs (`serverUsers`, `localId`, `lastSyncAt`, cleanup on user switch or server change) through the control channel (`02` §4.1).

| Scope | Where | Synced across devices? |
| --- | --- | --- |
| 1. App preferences | `{userData}/settings.json` | no |
| 2. Per-budget, per-device UI state | `{userData}/budgets/{cloudFileId}.json` | no |
| 3. Budget metadata & synced prefs | inside Actual (reserved notes, tags, synced prefs; `04` §5) | yes |
| 4. Secrets | `{userData}/secrets.json`, values encrypted with Electron `safeStorage` | no |

The Actual API cache (`{userData}/actual-cache/`) is managed by the API, not by this layer (`03` §2).

Rules of the settings store (`src/shared/settings.ts`, `src/main/settings-store.ts`):

- **Reading is tolerant, key by key.** A missing, invalid or damaged key falls back to its default, so a partly broken file still yields complete settings and keeps its valid keys. Unknown keys are dropped.
- **Writing is strict.** A patch is validated against the schema, and an invalid patch is refused without changing the file.
- **The renderer may write only its own keys.** `shell.settings.set` accepts the user preferences (`RENDERER_WRITABLE_APP_KEYS`: `openLastBudgetOnStartup`, the `lastPicked*` keys, `sidebarExpanded`, `zoomFactor`, `budgetHeaderExpanded`, `privacyMode`, `appearance`, `colorVision`, `language`, the `autofill*` keys, `clearCacheOnExit`, `fileAssociations`, `debugLogging`, `lastExportFolder`, `hints`, `notifyWhenUpdateIsAvailable`, `showNewsFeed`, `lastSeenNewsAt`, `updateNotificationShownForVersion`). The server, budget, user and window keys are written by main and the host. Budget patches from the renderer can't touch `localId`, `lastSyncAt` or `schemaVersion`, which belong to the host. A new key the renderer writes is added to that list here and in the code.

## 1. App preferences (`settings.json`)

| Key | Type | Default | Used by |
| --- | --- | --- | --- |
| `schemaVersion` | number | 1 | migrations |
| `serverUrl` | string \| null | null | `07` §2 |
| `openLastBudgetOnStartup` | bool | true | `07` §1 |
| `lastBudget` | `{ cloudFileId, groupId, name }` \| null. Matched by `cloudFileId`; `groupId` is a cache, refreshed on every open. | null | startup |
| `recentBudgets` | `Array<{ cloudFileId, groupId, name, lastOpenedAt }>` (max 10, newest first; matched by `cloudFileId`) | [] | Budget List |
| `lastPickedCurrency`, `lastPickedNumberFormat`, `lastPickedDateFormat` | string \| null | null → OS locale | Budget Setup |
| `sidebarExpanded` | bool | true | `08` §1 |
| `zoomFactor` | number, 0.8–2.0 | 1.0 | `22` §5; View ▸ Zoom (`06` §4) |
| `budgetHeaderExpanded` | bool | true | `09` §5.1 |
| `privacyMode` | bool | false | `06` §7: masks every money amount on screen |
| `appearance` | `'system' \| 'light' \| 'dark'` | `'system'` | `05` §1.9; `nativeTheme.themeSource` |
| `colorVision` | `'standard' \| 'cvd'` | `'standard'` | `05` §1.9 |
| `language` | `'system'` \| a shipped locale tag (`'de'`, `'pt-BR'`) | `'system'` | `20` §3.3; an unknown tag counts as `'system'` |
| `autofillCategory` / `autofillNotes` / `autofillAmount` | bool | **true / false / false** | `11` §4.3, `14` §4 |
| `clearCacheOnExit` | bool | false | `03` §2 |
| `fileAssociations` | bool | false | `07` §7 |
| `debugLogging` | bool | false | `07` §7; `02` §8: the log level of all three processes (off = `info`, on = `debug`) |
| `extraCaCertPath` | string \| null | null | `02` §6 |
| `serverUsers` | `{ [serverUrl]: userId }` | {} | the last signed-in server user per server; a change clears the other user's cached budgets (`03` §7.1) |
| `window` | `{ x, y, width, height, isMaximized }` (device-independent px) \| null | null → centered 1020×700 | `06` §1 |
| `lastExportFolder` | string \| null | null | `16` §2 |
| `firstRunVersion`, `lastRunVersion` | string \| null | null | first-run hints; the release notes don't use them (`24`) |
| `hints` | `{ [hintId]: true }` | {} | one-time hints |
| `notifyWhenUpdateIsAvailable` | bool | true | `24` §3: the update check; off, main never contacts GitHub |
| `showNewsFeed` | bool | true | `24` §4: the news feed, the bell and Help ▸ Notifications…; off, main never fetches the feed |
| `lastSeenNewsAt` | canonical timestamp (`YYYY-MM-DDTHH:MM:SSZ`) \| null; any other value reads as null | null | `24` §4.4: the news read state, always copied from a feed entry's `date` and only moved forward |
| `updateNotificationShownForVersion` | `X.Y.Z` \| null; any other value reads as null | null | `24` §3.3: the latest version whose update toast was closed on this device |

## 2. Per-budget, per-device UI state (`budgets/{cloudFileId}.json`)

Keyed by `cloudFileId`, because the `groupId` changes when a budget's sync is reset, for example when encryption is enabled.

| Key | Default | Used by |
| --- | --- | --- |
| `localId` | — | the API's local budget id for offline load (`03` §6.2) |
| `lastSyncAt` | null | offline banner |
| `lastScreen` | null | `06` §3 (`"budget"`, `"reports"`, `"all"`, `"account:{id}"`) |
| `onBudgetGroupCollapsed`, `offBudgetGroupCollapsed` | false | `08` §2.3 |
| **budget** `lastSelectedMonth` | null (= the current month) | `09` §3 |
| **budget** `categoryColumnWidth` | 14.5 (rem) | `09` §1 |
| **budget** `showEmptyOutflowTooltip` | true | `09` §6.6 |
| **budget** `collapsedGroups` | [] | `09` §4.2 |
| **register** `showPreImportDialog` | true | `16` §1.2 |
| **register** `accounts[accountId]` | defaults per `10` §2 / `12` §3 | `10` §10: `mainColumns[] {field, visible, width}` (width in rem), `scheduleColumns[]`, `mainSort [{field, desc}, …]` (1–4 sort keys, primary first, `10` §2; a stored single `{field, desc}` object is read as one key, and unknown or duplicate fields are dropped), `scheduleSort {field, desc}`, `dateFilter {label, start, end}` ("All Dates" when empty), `showReconciled` (true), `schedulerVisible` (false), `schedulerHeight` (rem; −1 → 15.5) |
| **payeeSettings** `lastPayeeId` | null | `14` §4 |
| **reports** `savedFiltersByPage` | empty object | `15` §3: saved filter definitions grouped by report page; durable per budget and device |

Entries for accounts/categories that no longer exist are dropped on load. New accounts copy column widths per `10` §2.

Saved report filters contain only named filter/option snapshots, not report results or transactions.
They are validated on load; definitions with invalid page names, ids, date ranges, or option shapes
are discarded with the normal settings validation warning. Deleting a referenced category, payee,
or account removes that id from saved definitions. Saved names are unique case-insensitively within
each page. These values use the existing atomic JSON settings path; they do not introduce a local
database.

The active Reports tab, shared current filters, filter drafts, and saved-filter override state are
not persisted. Every app launch starts Reports on Summary with default filters, even when
`lastScreen` restores the Reports destination.

## 3. Budget metadata (synced, inside Actual)

- Reserved notes `ad:payees`, `ad:cellnotes:{month}`, `ad:import-mappings`, `ad:budget` (`04` §5.3). `ad:budget.carryoverSeenEnd` is the last budget-range end the carryover extension has covered (`09` §6.4). It's synced so that every device continues where the last one stopped.
- Actual tag entities (user tags and the app-owned `needs-review` marker) and notes tokens (`04` §5.1–5.2).
- Actual synced prefs: currency, number/date formats, first day of week, hide-fraction, budget type (`04` §3).
- **Concurrency note:** reserved notes are whole-document last-writer-wins. Two devices editing *different* accounts' metadata never conflict (separate notes). Two devices editing the payee-disabled list at the same moment can lose one change. That's acceptable.

## 4. Secrets (`secrets.json`)

- Keys: `server:{url}` → the server **session token** (: never the password, `03` §7), `e2e:{cloudFileId}` → encryption password. It's keyed by `cloudFileId`, and deleted when it fails to decrypt, which means the password was changed elsewhere.
- Enabling encryption or generating a new key may change the budget's `groupId` but not its `cloudFileId`; refresh `lastBudget`/recent-budget sync ids from the server without changing the secret key. A failed encryption-password check deletes the corresponding `e2e:` secret. Enabling or rotating the key replaces the remembered password only after key creation and sync reset succeed. If **Remember** isn't ticked, a remembered password for the old key is deleted at that point instead, because it can no longer decrypt the budget.
- Values are encrypted with Electron's asynchronous `safeStorage` API (`encryptStringAsync`, `decryptStringAsync`) and stored base64; the synchronous calls are deprecated. Main applies secret operations one at a time in the order they arrive, so a value still being encrypted can't be written after a later delete or clear of the same key. When a read reports `shouldReEncrypt` (the OS key was rotated or upgraded), main encrypts the value again and saves it; if that fails, it keeps the old value, which still decrypts. A value that won't decrypt reads as absent. If `safeStorage.isAsyncEncryptionAvailable()` resolves false (some Linux setups without a keyring), the "Stay signed in" and "Remember" checkboxes are disabled with the tooltip "Your system doesn't provide secure storage, so Actuality can't keep you signed in or remember passwords."
- Secrets are never sent to the renderer after entry. Only the host reads and writes them, through the control channel (`02` §4.1). The renderer can only ask whether secure storage is available, whether a key exists, and forget a key (`02` §4).
- "Forget" actions delete entries. **Sign out** (`03` §7.3) deletes `server:{url}` and every `e2e:` entry, and clears `lastBudget` (§1).
- The host also keeps the open budget's encryption password **in memory** for the session, whether or not it's remembered (`03` §7). It's never written to disk unless "Remember" is ticked. Changing the server wipes **all** secrets, device-settings files (§2), `recentBudgets`/`lastBudget` and the offline cache, after confirmation (`03` §7.2).

## 5. In-memory session state (not persisted)

Register: search text per account, scroll position, selection, reconciliation in progress (statement date/target), the last date used for a new transaction, the undo token. Budget: scroll position, hover/selected category, focused cell.
