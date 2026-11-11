# 07 — Startup, Server Connection, Budgets, Budget Properties & Preferences

Before a budget is open, the app shows full-window **blue canvas** screens (background `--app-bg`, content in a centered `--canvas-col-w` column that narrows to fit the window; the screen scrolls vertically when its content is taller than the window). Once a budget opens, the main canvas slides in (350 ms; left when going forward, right when going back).

## 1. Startup sequence

1. Main creates the window (`06` §1) and the menu, and spawns the API host.
2. Command-line/file-association arguments are processed (a bank file → remembered for import once a budget is open, `16` §1.1).
3. If no server is configured → **Connect** screen (§2).
4. Else, if the preference "On startup, open the most recently accessed budget." (`openLastBudgetOnStartup`, default on) is on and `lastBudget` exists → **Loading** screen → sign in (below) → `session.openBudget(lastBudget)`. This includes the offline fallback (`03` §6.2). On failure → **Budget List** with the error shown in a TaskDialog.
5. Otherwise → sign in (below) → **Budget List**.

**Signing in at startup:**

- **With a stored token** (`server:{url}`, `19` §4): `session.connect` uses it directly.
- **Without one** ("Stay signed in" was off): the host runs `session.probeLogin`.
  - If the server answers, the Budget List is shown, empty, with the **sign-in modal** over it (`03` §6.3): the Password field, or **Sign in with {displayName}** on an OpenID server. That means a trip through the browser on every launch, which is accepted. After signing in, the list loads, and step 4 continues with `openBudget` if it applies.
  - If the server can't be reached, step 4's offline fallback still opens `lastBudget` from the cache (a local-only open needs no token). Otherwise the Budget List shows "Can't reach your Actual server at {url}." (`03` §6.2).
  
**After a budget opens:**

- due scheduled transactions are posted by Actual's schedule service after the first successful sync of the day (and after one that follows saving such a schedule). They appear through the `applied` sync event (`12` §2, `03` §4.1),
- once the session is `Online` (at once for a normal open, after the first reconnect for an offline open), the session start tasks run: a missing `needs-review` tag entity is created (`04` §5.2) and the carryover extension runs (`09` §6.4) (`03` §6.4),
- the sidebar is populated (expanded/collapsed per `19` §1 `sidebarExpanded`),
- the last screen is restored (`06` §3).

## 2. Connect screen

```text
┌──────────────────────────────────────────────────────────────┐
│                     [App wordmark]                           │
│   Connect to your Actual Budget server                       │
│   Server address:  [ https://budget.example.com          ]   │
│   Password:        [ ••••••••                            ]   │
│                    [x] Stay signed in on this computer       │
│                                       [Connect]              │
│   Don't have a server? Learn how to set one up.  (link)      │
└──────────────────────────────────────────────────────────────┘
```

- Validation: empty address → "Enter your server's address."; not http(s) → "The address must start with http:// or https://". The URL is normalized (trimmed, trailing `/` removed).
- **Sign-in method.** Leaving the address field, or pressing **Connect** with the password still empty, runs `session.probeLogin` (`03` §7). The rest of the screen follows the server's active method:
  - **password**: as drawn above;
  - **OpenID**: the Password field is replaced by the text "This server signs in with {displayName}." and the button reads **Sign in with {displayName}**. Pressing it runs `session.connectOpenId`. The screen then shows "Waiting for you to sign in to {displayName} in your browser…" with **Cancel**. "Stay signed in" applies to the token the same way;
  - **anything else**: "This server uses a sign-in method Actuality doesn't support yet." and Connect is disabled.

  Changing the address re-runs the probe.
- **Connect** (password servers) → `session.connect`. Errors per `03` §9. Certificate and http/https problems show the specific message and action button from `03` §9.1, inline under the address field. Success → the server URL is saved (`19` §1 `serverUrl`) → Budget List.
- The link opens `https://actualbudget.org/docs/install/`.
- Also reachable from Budget List ▸ **Change server…** and from Preferences. **Change server…** first wipes everything from the current server on this computer: the offline cache, per-budget device settings, recent budgets and stored secrets. It asks for confirmation first (`03` §7.2).

## 3. Budget List screen ("File Management")

```text
┌──────────────────────────────────────────────────────────────┐
│                     [App wordmark]                           │
│   ┌─────────────────────────────────────────────┐            │
│   │ [☁] My Budget                                 │  ← most recent (large button)
│   │     Last opened Today at 3:15 PM              │            │
│   └─────────────────────────────────────────────┘            │
│   [☁] Family Budget      01/12/26                           │  ← up to 4 more recent (small)
│   [🔒] Business (encrypted)  11/30/25                        │
│                                                              │
│   [Open another budget]   [Create a new budget]             │  ← small buttons (--control-h, sized to their labels)
│                                                              │
│   Connected to https://budget.example.com  ·  Sign out  ·  Change server… │
│ [←] Go Back (only when opened from the menu with a budget open) │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Recent budgets

- **Recent budgets** (max 5): this device's `recentBudgets` (most recent first, `19` §1), keeping only those still present in `getBudgets()` (matched by `cloudFileId`, which survives encryption and sync resets). The currently open budget is excluded. With no recent budgets, show the large stacked buttons instead: **[ Open an existing budget ]** "Choose from the budgets on your server" and **[ Create a brand new budget ]** "Never used Actuality? Start here".
- First recent budget: a large button with the bottom label "Last opened {date}" ("Today at 3:15 PM", "Yesterday at 3:15 PM", else the short date). Others: small buttons with the short date.
- Button visuals: `--app-bg-dark` translucent rounded rectangle (30% / 40% hover / 50% pressed, `--radius-sm`). Icon: cloud (on server), lock (encrypted, `hasKey`), and a small "offline copy" dot when a local cache exists.
- Tooltip: "{name}\nLast opened {date}\nServer: {url}" (+ "\nEnd-to-end encrypted").
- Click → Loading screen "Loading "{name}"" → main canvas.

### 3.2 Open Budget screen

- **Open another budget** → **Open Budget** screen: a list of every budget on the server (`getBudgets()` remote entries, sorted by name; columns Name, Encrypted, "Offline copy" ✓). On multi-user servers, a budget owned by someone else shows a **Shared** tag after its name, with the tooltip "Shared with you by the budget's owner." (`03` §7.1). The recent-budgets list on the Budget List screen shows the same tag. Double-click, Enter or **Open** opens the selected budget; the arrow keys move the selection. There is also a **Refresh** button, a **Back** button (to the Budget List, or to the open budget when File ▸ Open came straight here) and an **Import a budget file…** link (§3.4).
- Opened via File ▸ Open with no recent budgets → straight to the Open Budget screen.
- **Tracking budgets.** Actuality supports envelope budgets only (`01` §3). Opening a budget set to Actual's Tracking mode stops on the Loading screen (`03` §6.1), returns to the Budget List and shows the TaskDialog "This budget can't be opened in Actuality" / "It uses Actual's tracking budget type, and Actuality supports envelope budgets only. To open it here, switch it to envelope budgeting in Actual's settings." (**Close**). The same applies wherever a budget is opened: the startup open of `lastBudget` (§1), recent budgets (§3.1), crash recovery (`03` §6.5) and an imported file (§3.4). An Actual export of a tracking budget is refused before anything is uploaded, and the budget that was open stays open.

### 3.3 Other actions and states

- **Create a new budget** → Budget Setup (§4).
- **Sign out** → `session.signOut` (`03` §7.3): deletes this computer's stored sign-in and remembered encryption passwords, and forgets the last budget, so nothing opens at the next start without signing in. It keeps the offline cache, and returns to the Connect screen with the address filled in, so another user can sign in.
- **Server unreachable:** the screen shows only "Can't reach your Actual server at {url}." with **Retry** and **Change server…**. No budgets are listed, not even cached ones (`03` §6.2).
- **Go Back** (image button at the left edge, vertically centered, tooltip "Go Back") is shown only when the screen was opened from the menu while a budget was open. It returns to that budget.

### 3.4 Import a budget file

"What type of file?" (command links) → **Actual export (.zip)**, **YNAB 4 budget** ("Choose the budget's zip, or the Budget.ymeta file in its .ynab4 folder"), **nYNAB export (.json)** → an open dialog → `budgetFile.importFile(path, type)` → `importBudget(data, { type })` on the Loading screen ("Importing your budget."). File dialogs on Windows and Linux can't pick a file or a folder in one go, so a YNAB 4 budget folder is chosen through its `Budget.ymeta` file. Actual's YNAB 4 importer reads only zips: the host zips the `.ynab4` folder in memory (stored entries, the folder name as the root). A file the importer refuses shows "This file couldn't be imported. Check that it's the type of budget file you chose." and returns to the Open Budget screen. Integration tests confirm that the API **uploads** the imported budget to the server as a **new** budget, with a new `cloudFileId` and `groupId`, and leaves the original on the server untouched. The host job:

1. **Refuse a tracking budget** (Actual export only): read the type from the zip, before anything changes (`03` §6.1).
2. **Close the open budget first** (`shutdown` + `init`, with the unsynced-changes check: `03` §3 "Single budget" and `03` §5.4). The import reuses the local id stored in an Actual zip. If that budget is cached on this device, which is typical when restoring your own backup, its **local copy is overwritten** and re-pointed at the new server file. The original is still on the server and is downloaded fresh the next time it's opened.
3. `importBudget(…)`. The API leaves the imported budget loaded.
4. **Confirm the upload.** The API only logs upload errors, so the host checks that `getBudgets()` now has a `state: "remote"` entry for the imported budget's `cloudFileId`. If it doesn't, show the TaskDialog "The budget was imported on this computer but couldn't be uploaded to your Actual server. Check your connection and try again." (**Close**). The local-only copy isn't listed, and **Clear Offline Cache…** removes it.
5. **Avoid a duplicate name.** If another server budget already has the same name, rename the import to "{name} (imported {YYYY-MM-DD})" using the rename handler (§4).
6. Run the normal open flow (`03` §6.1) on it.

## 4. Budget Setup / Budget Properties

```text
 Budget     Budget Name:            [ My Budget                     ]
 Setup
            Starting Categories:                          (new budgets only)
            You can customize these after your budget is created.
            (•) Personal/Family   ( ) Small Business

            Currency & Date Formats:
            Currency:      [ US Dollar (USD) ▾ ]
            Which Format?  [ 1,234.56 ▾ ]
            Date Format:   [ 12/31/2026 (MM/DD/YYYY) ▾ ]
            [x] Hide decimal places
            First day of week: [ Sunday ▾ ]       (Budget Properties only)
            End-to-end encryption: [Not enabled]   [Enable encryption] (Budget Properties only)

                                          [Cancel] [Create Budget]
```

- Title "Budget\nSetup" (new) or "Budget\nProperties" (File ▸ Budget Properties…). The primary button is **Create Budget** or **Save Changes**. **Cancel** or Esc closes.
- **Creating budgets on the server works with the public `runImport`**. It also strips Actual's default expense categories, so the template applies to an empty budget. The API only logs upload failures, so the host confirms the upload (Create flow below).
- Field mapping (Actual synced prefs, `04` §3):
  - Currency → `defaultCurrencyCode` (ISO list from `Intl.supportedValuesOf('currency')`, labelled "{Name} ({CODE})"). Choosing one also writes `flags.currency: "true"`, as Actual web does (`04` §3). Budget Properties of a budget with no currency (`""`) also offers **No currency**, so saving other changes keeps it; Budget Setup requires a currency.
  - "Which Format?" → `numberFormat` (Actual's values, e.g. `comma-dot` "1,234.56", `dot-comma` "1.234,56", `space-comma` "1 234,56", `apostrophe-dot` "1'234.56", `comma-dot-in` "1,23,456.78". `space-comma` uses a narrow no-break space, U+202F). It is disabled when only one format is sensible.
  - Date Format → `dateFormat` (`MM/dd/yyyy`, `dd/MM/yyyy`, `yyyy-MM-dd`, `MM.dd.yyyy`, `dd.MM.yyyy`).
  - Hide decimal places → `hideFraction`.
- **Budget Properties only:** **First day of week** is a dropdown with the localized weekday names Sunday through Saturday, in that order. It reads and writes the synced Actual preference `firstDayOfWeekIdx` as a string index (`"0"` = Sunday through `"6"` = Saturday; `04` §3). If the preference is unset, the selection follows the current UI locale's week start without writing a value until the user chooses one. A chosen day controls the first column of every calendar grid in the app; weekday names remain localized (`20` §3.3, `22` §2.3). Budget Setup does not show this dropdown.
- **Budget Properties only:** an **End-to-end encryption** section shows the server's encryption status (`hasKey`, `03` §1). When not encrypted, **Enable encryption** opens a password dialog; when encrypted, the status reads **Enabled** and the action is **Generate a new key**. This is an explicit action, not a toggle: encryption cannot be disabled in place. If the server status can't be read while offline, show it as unknown rather than implying encryption is off. Neither action is available in `OfflineReadOnly` or before a server budget is open. Creating a new budget does not enable encryption as part of Budget Setup.
- **Encryption confirmation and password flow** (`03` §7): explain that enabling encryption or generating a new key resets sync, uploads this device's current budget as the source of truth, and can discard changes on other devices that have not synced to it. Tell the user to sync other devices first. Also explain that a forgotten password cannot decrypt server data, encryption cannot be turned off in place, the local cache and budget backup exports remain unencrypted, and bank-sync credentials are not covered. The user enters an encryption password distinct from the server sign-in password; provide a show/hide control and an optional **Remember on this computer** choice using secure storage. Do not retain or log the password beyond the host's in-memory session handling (`02` §6, `19` §4). Key generation is randomized, so generating a new key changes it even if the same password is entered.
- **Apply encryption separately from Save Changes.** The encryption action is its own confirmation and host operation, not a field in `budgetFile.updateProperties`. It calls `budgetFile.setEncryptionKey(password, remember)` while online. The host invokes Actual's internal `key-make` within the serial queue and write gate; it must not report success unless the handler completes without an error. On success the current budget remains open, the host refreshes `hasKey` and the current `groupId`, keeps the password in memory (and in safe storage only when Remember is selected), then syncs and refreshes the encryption status. If Remember was chosen but secure storage fails to save the password, the key change still counts as a success: the result reports it (`rememberFailed`) and a warning says the password wasn't remembered, so the user expects to be asked for it next time. Likewise, if Remember wasn't chosen and a remembered password for the old key can't be deleted, the result reports `forgetFailed` and a warning says the old password is still saved; it no longer works and is deleted when it fails at the next open (`19` §4). On failure, surface the actual error, refresh the server state if the outcome may be uncertain, and do not automatically retry because key creation is randomized and performs a sync reset.
- Defaults: name "My Budget"; currency/format/date = the last picked ones (`19` §1), else from the OS locale. Properties mode shows the budget's current values. In properties mode the **name is editable**. **Save Changes** renames the budget on the server and locally through the internal handler `save-prefs { budgetName }` (`03` §3). Names are trimmed and must be non-empty. If the handler is unavailable, the name field is read-only, with the tooltip "Rename this budget in Actual's web app". On a **Shared** budget (multi-user servers) it is read-only too, with the tooltip "You don't have permission to do that on this budget. Ask the budget's owner or the server's admin." (`03` §7.1).
- Validation: "You need to give this budget a name first"; "You need to select a currency and currency format first"; "You need to select a date format first". Stop on error (the reference design had a bug that continued; don't copy it).
- Create flow (`budgetFile.create`, one host job): Loading screen "Creating your new budget."
  1. Close the open budget (with the unsynced-changes check, `03` §5.4).
  2. `runImport(name, async () => { …create the template's groups and categories (§4.1); setPreference(currency/number/date/hideFraction)… })`. This creates the budget locally and uploads it in its final state. `createCategoryGroup` appends each group, and `createCategory` puts each category at the top of its group (`04` §3), so the job adds a group's categories last to first and the template keeps its order without the move handlers.
  3. **Confirm the upload**: `getBudgets()` must contain a `state: "remote"` entry with this budget's `cloudFileId`. Straight after `runImport` the new **local** entry may not list its `cloudFileId` yet (API 26.11.0), so the host takes it from the server entry that is new since the import started and has this name. If not, show the TaskDialog "Your budget was created on this computer but couldn't be uploaded to your Actual server. Check your connection and try again." (**Close**), and return to the Budget List.
  4. `sync()` → `Online` → main canvas (Welcome panel).

  If the server already has a budget with the same name, the name is refused first, using the same check as `getBudgets()`: "You already have a budget named '{name}' on this server".
- Properties in `OfflineReadOnly`: all fields are disabled, encryption status is unknown if the last server status is unavailable, the encryption actions and **Save Changes** are hidden, and only **Close** is shown.

### 4.1 Starting category templates

The names below are the English source. Each group and category name is an i18n key in the `templates` bundle. The template is created with the names in the UI language at that moment, and the names are never re-translated afterwards: they're the user's data (`20` §3.8).

#### **Personal/Family**

| Group | Categories |
| --- | --- |
| Giving | Tithing, Charitable |
| Monthly Bills | Rent/Mortgage, Phone, Internet, Cable TV, Electricity, Water, Natural Gas/Propane/Oil |
| Everyday Expenses | Groceries, Fuel, Spending Money, Restaurants, Medical, Clothing, Household Goods |
| Rainy Day Funds | Emergency Fund, Car Repairs, Home Maintenance, Car Insurance, Life Insurance, Health Insurance, Birthdays, Christmas |
| Savings Goals | Car Replacement, Vacation |
| Debt | Car Payment, Student Loan Payment, Personal Loan Payment |

#### **Small Business**

| Group | Categories |
| --- | --- |
| Marketing | Printing, Online, Referral Fees, Commissions |
| Services | Accounting, Legal, Contractors, Other |
| Office | Rent, Telephone/Fax, Internet |
| General | Meals & Entertainment, Office Supplies |
| Travel | Automobile, Hotels/Lodging, Airfare, Other |
| Taxes & Licenses | Unemployment, Payroll, Quarterlies |

Income: ensure the income group contains at least one income category. A budget created with `runImport` contains **no** expense groups, only Actual's income group with "Income" and "Starting Balances". Actual names those two itself, in English, and the app leaves them as they are. So the template is applied as is, and nothing needs deleting. If the income group is ever empty, the host creates one income category named with the translated "Income".

### 4.2 Formatting helpers (`src/shared/format.ts`)

| Formatter | Example (en-US) | Used for |
| --- | --- | --- |
| `currencyPlain` | `1234.56` | editable fields, CSV export |
| `dateShort` | per `dateFormat`, two-digit year in grids that use `MM/DD/YY` | register, recent dates |
| `dateLongYear` | `01/31/2026` | CSV export |
| `monthHeader` | `January 2026`; current month `January 2026 (Current)` | headers |
| `monthShortYear` | `Jan '26` | timeline |
| `recentDate` | "Today at 3:15 PM" / "Yesterday at 3:15 PM" / short date | budget list |

Amounts shown on screen don't go through these helpers. They go through `<MoneyAmount>` and `renderer/money-display.ts` (`06` §7), which apply privacy mode. Both use `format` in `shared/money.ts`: `$1,234.56` with the symbol (totals, summaries, dialogs, All Accounts), `1,234.56` without (budget grid, register cells, sidebar balances). The symbol position and space come from `currencySymbolPosition`/`currencySpaceBetweenAmountAndSymbol`. Negatives use a leading `-`.

## 5. Loading screen

A centered spinner (the logo spinner, `05` §5) and message ("Loading "{name}"", "Creating your new budget.", "Connecting to {url}…") on the blue canvas. Errors return to the previous screen with a TaskDialog. If loading takes longer than 10 s, show a **Cancel** link (→ shut down and return to the Budget List).

## 6. Saving & backups (X5, X9)

- Every change is written immediately through the API and synced (`03` §5). There is no "Save" and no dirty marker. **Ctrl+S** = Sync Now. On success it briefly shows "Synced" next to the sidebar indicator.
- **File ▸ Export Budget Backup…** → save dialog (default name `"{budget} backup {YYYY-MM-DD HHmm}.zip"`) → `budgetFile.exportBackup(path)`: the host runs `exportBudget()` and writes the zip to the chosen path itself, like every other host export (`16` §2, `18` §2). Success dialog: "Backup saved" / "{path}" with **Show in Folder** / Close.

## 7. Preferences (File ▸ Preferences… / ⌘,)

Blue-canvas screen titled **Preferences**:

| Section | Setting |
| --- | --- |
| Startup | [x] "On startup, open the most recently accessed budget." (`openLastBudgetOnStartup`, default on) |
| Server | "Connected to **{url}**" (or "Not connected"), **Sign out** (`03` §7.3), **Change server…** (closes the current budget, wipes this server's data from this computer after confirmation, `03` §7.2, then the Connect screen), [ ] "Stay signed in on this computer" (`session.setStaySignedIn`: stores the current session token, never the password, `03` §7; unticking deletes the stored token), **Trust a certificate file…** / **Remove** ("Use this if your server uses a self-signed certificate. Takes effect after restarting Actuality."; the file dialog's filter is "Certificate files" for `.pem`, `.crt` and `.cer`) |
| Offline Cache | "Budgets you open are cached on this computer so you can view them while offline. Changes are only possible while connected." Path (read-only) + **Show in Folder** + **Clear Offline Cache…** (confirm: "Clear offline cache?" / "This removes the cached copies of your budgets from this computer. Your budgets on the server are not affected." **Clear cache** / Cancel). [ ] "Clear the offline cache when I quit Actuality" (`clearCacheOnExit`, default off) |
| Appearance | "Theme:" ( ) "Use system setting" ( ) "Light" ( ) "Dark" (`appearance`, default "Use system setting"). [ ] "Use color-blind friendly colors" (`colorVision`), with the hint "Shows positive and negative amounts and status in blue and orange instead of green and red." Changes apply immediately (`05` §1.9). |
| Tags | **Manage Tags…** → the Tags manager (`04` §5.2): view and search tags, create them or choose which tags already used in notes to add (**Discover New Tags**, with **Add YNAB flags** while there are no `flag-` tags), edit colors and descriptions, rename or delete tags, and view matching transactions. |
| Language | "Language:" drop-down: "Use system setting", then each shipped locale by its own name (`meta.json` `name`, `20` §3.1), sorted alphabetically (`language`, default "Use system setting"). Changes apply immediately (`20` §3.3). |
| Auto-fill (all payees) | [x] Category [ ] Notes [ ] Amount — the same three settings as the Payee Settings footer (`14` §4) |
| File Associations | [ ] "Use Actuality to open bank statement files (.OFX, .QFX, .QIF, .CSV)?" (Windows/Linux registration on toggle; macOS: declared in `Info.plist`, so the checkbox is hidden and the text "Actuality can open bank statement files (.OFX, .QFX, .QIF, .CSV)." is shown) |
| Updates and News | [x] "Display a notification when updates are available" (`notifyWhenUpdateIsAvailable`, default on), with the hint "Actuality checks api.github.com for a new version when it starts and once a day. Nothing about you or your budgets is sent." [x] "Show in-app notifications (release notes and announcements)" (`showNewsFeed`, default on), with the hint "Actuality downloads the latest posts from actualitydesktop.org. Nothing about you or your budgets is sent." Both take effect at once, with no restart; turning one off stops its requests and removes its toast (`24` §2.1). |
| Diagnostics | [ ] "Enable debug logging" (`debugLogging`, default off), with the hint "Records detailed diagnostic information in the log file to help find problems. Passwords, tokens and budget contents are never recorded." It is the last setting, just above **Done**. It takes effect at once, in every process, with no restart, and is remembered between launches (`02` §8.3). |
| | **Done** |
