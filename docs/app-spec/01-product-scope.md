# 01 — Product Summary, Scope & Deviations

## 1. Product summary

Actuality is an envelope-budgeting desktop client for budgets stored on an Actual Budget server.

**Product direction:** Actuality prioritizes polish and stability. It should not be used for experimental features or anything unsupported by the official Actual APIs.

- **Accounts** (on-budget and off-budget/tracking) with a transaction **register**. It supports inline editing, splits, transfers, payees with memorized auto-fill, colored transaction tags, cleared/reconciled states, bank-file import with duplicate detection, scheduled transactions, reconciliation and a search language.
- **Budget**: envelope budgeting with month columns showing Budgeted / Outflows / Balance per category, and an "Available to Budget" header with the math behind it. It also has overspending handling (carryover), Quick Budget, a calculator, notes and hidden categories.
- **Reports**: five read-only reports (Summary, Spending Breakdown, Spending Comparison, Inflow vs Outflow, and Net Worth), with linked filters, per-page saved filters, CSV, and Print. Actual Budget's Custom Reports and Crossover Point are out of scope (`15`).
- **Budget management**: connect to a server, list/open budgets, budget properties (currency/date formats and per-budget end-to-end encryption), slate wipe, export/print.

## 2. In scope

| Area | Chapter |
| --- | --- |
| Server connection (password or OpenID sign-in, `03` §7), budget list, open, create, rename, import, properties (including per-budget end-to-end encryption), preferences | `07` |
| App shell, native menus, shortcuts | `06` |
| Sidebar with account groups, drag-and-drop, badges | `08` |
| Budget screen (envelope mode) | `09` |
| Register, search, actions, undo | `10` |
| Inline transaction editor, splits, transfers, auto-fill | `11` |
| Scheduled transactions | `12` |
| Account create/edit/close/delete, reconciliation | `13` |
| Payees, rename rules, Payee Settings | `14` |
| Rules: the list and editor for every Actual rule | `23` |
| Summary, spending, cash-flow, and net-worth reports; Custom Reports and Crossover Point are out of scope | `15` |
| Bank import (OFX/QFX/QIF/CSV), CSV/QIF export, printing | `16` |
| TaskDialogs, callouts, tooltips | `17` |
| Help/About, Wipe the Slate Clean | `18` |
| Read-only offline viewing of cached budgets | `03` §6 |
| Accessibility: keyboard, screen readers, zoom, color-blind-safe palettes | `22` |
| Notifications: the update check and the news feed | `24` |

## 3. Out of scope

- Actual features with no equivalent in the app: bank sync (GoCardless/SimpleFIN), budget templates/goals (`#template` notes are shown as plain note text), multiple account groups UI. Actuality does not set up or manage Bank Sync; users must use the official Actual web or desktop app to set it up. It preserves fields it doesn't understand.
- Actual Budget's Tracking mode is out of scope; Actuality's budget screen supports envelope budgets only. Opening a tracking budget stops with a warning (`07` §3.2). This does not exclude off-budget (tracking) accounts.
- Actual Budget's Custom Reports and Crossover Point. Report drill-through from Summary widgets and table cells, and Excel/PDF export formats, are out of scope (`15`).
- Payee locations (Actual's suggestion of nearby payees from the device's position when entering a transaction). Actuality is a desktop app, so it doesn't read the device's location, show nearby payees or record locations. Locations saved by Actual's mobile web app are left untouched.
- Server sign-in methods other than password and OpenID (e.g. header auth). They get the "not supported yet" message (`03` §7).
- Server administration in multi-user mode: managing users, granting budget access, transferring ownership. These happen in Actual web; the app only shows a **Shared** tag (`03` §7.1).

## 4. Deviations from the reference design

Most deviations exist because Actual's data model or API differs. Chapters reference these IDs.

| ID | Reference behavior | Actuality behavior | Why |
| --- | --- | --- | --- |
| X1 | Income categorized per transaction as "Available this month" or "Available next month". | Income uses Actual's **income categories** (any number). Deferring income is done per month with **Hold for next month…** in the month header menu. The header shows a "Held for next month" line when non-zero. | D2: Actual engine. |
| X2 | Overspending handling "Subtract from next month's Available to Budget" (AffectsBuffer) vs "Subtract from next month's category balance" (Confined), inherited month to month. | Same popover and texts, stored as Actual's per-category, per-month **carryover** flag (Confined = carryover on). Setting it in a month applies it to that month **and every later month**, overwriting later settings (Actual's propagation). Months Actual adds later as the calendar advances are extended by the host (`09` §6.4). | D2 |
| X3 | Budget numbers computed by the original engine. | Read from `getBudgetMonth`. Uncategorized row and Quick Budget averages are computed by the app with ActualQL. | D2 |
| X4 | Matched transactions keep a "Bank:/Yours:" pair and can be **Unmatched**. | Import matching is done by Actual's `importTransactions` reconciliation. Manual **Match** uses `mergeTransactions` and cannot be undone. No **Unmatch**, no matched sub-lines. Matched/updated imports get the review tag. | Actual has no matched-pair storage. |
| X5 | "Load Another Version" lists local backups. | Replaced by **File ▸ Export Budget Backup…** (zip via `exportBudget`). Restore is via **Open ▸ Import a budget file…**, which uploads the backup as a **new** server budget. | No backup API. |
| X6 | Sync icon and settings. | **Connection indicator** for the Actual server (online / syncing / offline read-only / unsynced changes / error). | Different sync system. |
| X7 | Budget files on disk, folder preferences. | Budgets listed from the server. Preferences show **Server URL** and the cache location instead of folders. | Server-based. |
| X8 | Works fully offline. | **Read-only when the server is unreachable.** Edits are blocked and a banner explains why (`03` §6). | Requirement 4. |
| X9 | Title-bar "*" dirty marker, "Save a Version". | No dirty marker. **Ctrl+S = "Sync Now"**. Every change is saved immediately and synced. | Actual saves each change. |
| X10 | Hidden sub-categories move under a "Hidden Categories" master with mangled names. | Actual's `hidden` flag on categories and groups. The UI still shows a synthetic **Hidden Categories** row. Hiding a master hides the group (it is not deleted). | Native feature. |
| X11 | A debt master category. | **Dropped.** There is no debt category: a negative starting balance goes to an income category like any other (`13` §2.1). | D7 |
| X12 | Payee "List and Autocomplete" flag stored on the payee. | Stored in the reserved note `ad:payees` (`04` §5.3). | No Actual field. |
| X13 | Auto-fill notes/amount stored per payee. | Derived from the payee's most recent transaction. Auto-fill category uses the payee's Actual category rule if any, else the most recent category. | Avoids extra storage. Same observable behavior. |
| X14 | Payee rename conditions on the payee. | Stored as Actual **rules** (stage `pre`, condition on `imported_payee`, action set `payee`). Starts-with/Ends-with use `matches` with an anchored, escaped regex. All ops are case-insensitive. Actual applies rules to **every** import, so bank text matching a disabled payee is sent only as `imported_payee` and stays unassigned unless a rename rule matches (`14` §2). | Native feature. |
| X15 | The original client enters due scheduled transactions itself, asking first if the clock jumped by more than a day. | **Actual's own schedule service** posts due occurrences, catching up on missed ones, after the first successful sync of the day and after one that follows saving such a schedule. It runs inside Actuality's API host or any other Actual client, and posted occurrences arrive tagged for review. There is no clock-jump prompt. The next date is Actual's `next_date`. Schedules created elsewhere with patterns the reference design can't express show as "Custom" (`12` §2). | Actual's schedule model. |
| X16 | Starting a budget picks a Personal/Small Business template, currency locale and date locale. | Same screen. Budgets are created on the server with `runImport`. Currency/number/date formats map to Actual synced preferences (`defaultCurrencyCode`, `numberFormat`, `hideFraction`, `dateFormat`). | Actual prefs model. |
| X17 | Starting over saves a copy next to the budget. | Saves a **backup zip** to a user-chosen location. There is no server copy. The "advanced" cutoff month is reached with Alt. | API limits. |
| X18 | Actual supports non-envelope Tracking budgets. | Tracking-mode budgets are out of scope; Actuality supports envelope budgets only. Off-budget (tracking) accounts remain supported. | Product scope |
| X19 | Error for an on-budget↔on-budget transfer with a category. | Same, computed by the app. Actual itself may permit it. | Same UX. |
| X20 | Account notes in the account record. | Account **note** = Actual's native account note, id `account-{id}` (visible in Actual). There is no account type: Actual has none, and the app stores none. The last reconciliation time is Actual's own `last_reconciled` account field (`13` §6.2). | D1 |
| X21 | The Budget screen can be scrolled to any month. | Only months in Actual's budget range can be shown: from 3 months before the earliest transaction through 11 months after the current month. Months outside it are grayed out (`09` §2–3). | `getBudgetMonth` throws outside the range. |
| X22 | Each side of a transfer has its own notes and check number. | Notes (including tags), check number and review state are **shared by both sides** of a transfer. Editing them on one side changes the other (`04` §5.1). Cleared/reconciled state stays per side. | Actual copies the whole `notes` field between transfer sides. |
| X23 | A transaction the user enters is never matched to a scheduled transaction automatically. | A transaction that matches a schedule's payee, account, amount and approximate date is **linked** to it by Actual. That counts as paying the occurrence. For transactions entered in Actuality, the user's notes and tags, check number, category and approved state are restored after linking. The schedule's category is used only when the user left it empty (`12` §2). Transactions entered in other Actual clients get the schedule's values. The restore works because Actual doesn't re-run rules on updates (`12` §2). | Actual's schedule rules. |
| X24 | Light theme only, with red/green color meanings and a lighter sidebar blue. | **Dark** and **color-blind safe** (CVD) palettes, chosen in Preferences or View ▸ Appearance; the default follows the OS. The Light palette is inspired by YNAB 4, with the sidebar blue and a few text colors darkened to meet WCAG AA contrast (`05` §1.10). The CVD palettes move red/green meanings to blue/orange and add non-color marks (`05` §1.9–1.10). | Accessibility. |
| X25 | The Edit Transactions menu can't change the date of several transactions at once. | **Change Date…** sets one date on every selected transaction (`10` §6.1). | Usability. |
