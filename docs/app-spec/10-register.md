# 10 — Accounts Register (Transaction List)

The register shows the transactions of one account, or of **All Accounts**: every transaction of every account, including closed and off-budget ones. In that view the Account column is shown and the summary covers everything. The register has an account header (single account only), a notifier strip, a toolbar, a sortable/filterable virtualized grid with inline editing (`11`), a footer with balances and reconciliation (`13` §6), and an optional **Scheduled Transactions** pane (`12`) below a splitter.

## 1. Layout

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Checking  [🗒] [✎]                                                               [⋯] │ ← account header (single account, 13 §3)
│ [! 1 Transfer to an On-Budget account has a category Show] [⚠ 2 Warnings Show]   │ ← notifier strip (when needed)
│ [⏰ 3 Transactions need to be approved  Show]          [ 1 Transaction has been deleted  Undo ] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ [✎ Edit Transactions ▾] [＋ Add] [⇄ Transfer] [⇩ Import]     [◉|○] [All Dates ▾] [🔍 Search Checking ]│ ← toolbar (--control-h)
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Showing 12 results for "Payee: Kroger" during "This Month"            [✕ Clear Search]│ ← search info bar
├──┬───────┬────────┬───────┬──────────────┬─┬───────────────┬──────────────┬───────┬───────┬──────────┬──┤
│☐ │Account│ Date   │Check #│ Payee        │!│ Category      │Notes         │Outflow│ Inflow│ Balance   │C │[⚙]
├──┼───────┼────────┼───────┼──────────────┼─┼───────────────┼──────────────┼───────┼───────┼──────────┼──┤
│☐ │       │01/02/26│       │ Kroger       │ │ Groceries     │              │  52.10│       │  1,947.90│C │
│☐ │       │01/03/26│       │ Transfer : Sav│ │              │              │ 100.00│       │  1,847.90│  │
├──┴───────┴────────┴───────┴──────────────┴─┴───────────────┴──────────────┴───────┴───────┴──────────┴──┤
│ [⏰ Scheduled   (3)]   ┌Cleared Balance┐ + ┌Uncleared Transactions┐ = ┌Working Balance┐ [Reconcile]│
│ [  Transactions   ]   │  $1,900.00   │   │     -$52.10          │   │  $1,847.90    │ [ Account ]│ ← footer
├═════════════════════════════════ splitter ═══════════════════════════════════════════┤
│                     ( Scheduled Transactions )                                        │ ← scheduler pane (12)
└─────────────────────────────────────────────────────────────────────────────────────┘
```

| Element | Spec |
| --- | --- |
| Account header | single account only: name, Notes and Rename buttons, ⋯ menu (Close / Re-open); content height; behavior in `13` §3–4 |
| Reconciling title | while reconciling only (§7.3): its own line between the account header and the notifier strip, 600 `lg`. A separate element: the header above it keeps the plain account name and its buttons |
| Panel padding | `--space-3` left and right, `--space-1` top, none at the bottom; register min height 19 rem, relaxed when the window is too short for it (the panel then scrolls vertically) |
| Toolbar | gap and padding `--space-3`, buttons `--control-h`. Every control, the reconciled filter and the search box included, has the buttons' rounded-rectangle shape (`--radius-sm`, `05` §4). The action group (Edit Transactions, Add, Transfer, Import) stays left; an auto spacer pushes the filter group to the right edge. The right-aligned filter group is ordered Reconciled filter, Date filter, Search box. |
| Row height | `--row-h` |
| Footer | content height (taller while reconciling, `13` §6) |
| Scheduler pane | `--scheduler-h` (default 15.5 rem, min 14.25 rem); vertical splitter with live dragging. When the panel can't fit the register's minimum height plus the pane's minimum, the pane hides automatically without changing `schedulerVisible`, and returns when there's room. The Scheduled Transactions button still shows it on request; the panel then scrolls. |
| Grid header | `--grid-header-bg`, white 600 `md`. Labels align with their cells: Outflow, Inflow and Balance right, C and the select-all checkbox centred, the rest left. Each sort-key column is highlighted and shows a ▲/▼ arrow, plus its level number when there are several keys (§2). |
| Rows | 400 `body` `--text-grid`; alternating `--row-alt-even/odd`; grid lines `--grid-line-h/v`; selected row `--row-selected` |
| Row being edited | border `--row-edit-border`, background `--row-edit-bg` |
| Split sub-rows | background `--budget-row-alt-even`/white, border `--split-border` |
| Virtualization | `@tanstack/vue-virtual`, fixed rows of the computed `--row-h` (`05` §3.5). Expanded split sub-rows are extra virtual rows. The editor row's height is measured. |

## 2. Columns

| # | Column | Header | Default width (rem) | Visible by default | Hideable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Select | ☐ | 2.5 | yes | no | Header checkbox selects all or clears the selection; when some but not all rows are selected, it shows an indeterminate (horizontal dash) icon. Clicking it in that state clears the partial selection. |
| 1 | Account | "Account" | 5.75 | All Accounts only | no | editable drop-down while editing |
| 2 | Date | "Date" | 5.75 (min 5.75) | yes | no | short date |
| 3 | Check # | "Check #" | 5.75 | **no** | yes | |
| 4 | Payee | "Payee" | 13.5 | yes | no | Transfer rows show a transfer icon after the name (one icon for every account: there are no account types, `13` §1). Clicking it jumps to the other side. Tooltip: payee name, or "Current Payee: {payee}\nImported Payee: {importedPayee}" when they differ. |
| 5 | ! | " ! " | 2 | only when the account has any non-none error level | no | icon; click → resolution popover (§6.3) |
| 6 | Category | "Category" | 13.5 | on-budget accounts and All Accounts | no | §2.2 |
| 7 | Notes | "Notes" | 11.5 | yes | yes | decoded note text with colored tag pills (`04` §5.1–5.2); content stays on one line and clips at the cell edge |
| 8 | Outflow | "Outflow" | 5.4 | yes | no | no symbol, thousands separators, blank if 0 |
| 9 | Inflow | "Inflow" | 5.4 | yes | no | same |
| 10 | Running Balance | "Balance" (column menu: "Running Balance") | 5.4 | **no** | yes (not offered in All Accounts) | `--running-balance-text`; tooltip §7.4; not sortable |
| 11 | Cleared | "C" | 2.5 (7 while reconciling) | yes | yes (forced visible while reconciling) | §6.4 |

- Account, Check #, Payee, Category and Notes can be resized (widths saved per account, in rem, `05` §3.5). The others are fixed. Extra width is shared among the resizable columns. The rows' scrollbar takes width only while it shows: when the rows fit, the columns reach the grid's right edge with no empty gutter, and while it shows, the header pads by its width so the header columns stay over the row columns. The Scheduled Transactions grid (`12` §3) does the same.
- **Column chooser:** right-click any header, or press Shift+F10 (or the Menu key) on a focused header (`22` §4). There is no gear button: a right-click and the keyboard both reach it. It lists the toggleable columns with checkmarks: "Check", "Cleared", "Notes", "Running Balance" (Running Balance is omitted in All Accounts). Then a separator and **"Apply current settings to all existing accounts"**. Visibility and widths are saved **per account** (`19` §2). The first time an account is shown, it copies **widths** (not visibility) from the first other account with the same visible columns. When saving, an account's widths are also copied to every other account with the same visible columns.
- **Sorting:** the register sorts by an ordered list of up to 4 **sort keys** (column + direction), the first being the primary key. Default: one key, **Date descending** (newest at the top). Transactions on the same date are ordered by signed amount ascending: largest outflow first, then smaller outflows, zero, and inflows from smallest to largest (largest inflow last). This same-date amount order is independent of the Date direction unless Outflow or Inflow is explicitly included as a sort key.
  - **Click** a header: sorts by that column alone, replacing every key. Clicking the column again when it is the only key reverses it. (With several keys, a plain click on any column makes it the only key, ascending, unless it is already the primary key, in which case it becomes the only key with its direction reversed.)
  - **Shift+click** a header (multisort): a column that is not a key is **added** as the last key, ascending. A column that is already a key cycles ascending → descending → **removed** (its position among the keys is kept while it cycles; the later keys move up when it is removed). Removing the last remaining key restores the default (Date descending). At 4 keys, Shift+click on a new column does nothing. Columns that are not sortable (Running Balance, Select) ignore both clicks.
  - **Comparison:** rows are compared by the first key, then the second, and so on, each in its own direction. Rows still tied are ordered by the **fixed tie-break chain** Date → Amount → Check # (natural order) → Payee → Category → Notes → Cleared → Error level, skipping columns that are already keys, then by id. The chain and id take the direction of the **primary** key, except same-date Amount ties use signed amount ascending regardless of Date direction: this puts larger outflows above smaller outflows and larger inflows below smaller inflows, matching the default same-day order. An explicitly selected Outflow or Inflow key uses its own direction as usual.
  - **Header display:** each key's column is highlighted and shows ▲/▼. When there are 2 or more keys, a small level number (1–4) follows the arrow. Tooltip on a sorted header: "Sorted ascending, level {n}. Shift+click to add or change a sort level." or "Sorted descending, level {n}. Shift+click to add or change a sort level." (`register.sortTooltipAscending` / `register.sortTooltipDescending`); on an unsorted header: "Shift+click to add a sort level." (`register.sortTooltipUnsorted`).
  - **Keyboard:** on a focused column header, Enter sorts as a click and **Shift+Enter** as a Shift+click (`22`). `aria-sort` is set on the primary key's header only; the other keys' headers have an `aria-description` "Sort level {n}, ascending" or "Sort level {n}, descending" (`a11y.sortLevelAscending` / `a11y.sortLevelDescending`).
  - **Reconciliation** still forces Date ascending (`13` §6.2) and ignores the saved keys until it ends; header clicks are ignored meanwhile. The saved keys are not changed. Same-day transactions retain the default amount order.
  - **When it is applied:** when the data loads or changes after a commit, on **F5**, and on filter changes, never live while a row is being edited. The sort is saved per account (§10). The Scheduled Transactions pane keeps its single-key sort (`12` §3); multisort is for the register only.

### 2.1 Row styles by error level

| Level | Text | Category cell |
| --- | --- | --- |
| none | 400 `--text-grid` | normal |
| forReview | **bold** | normal |
| needsCategory | regular | pill (`--needscat-pill-bg`, italic `--needscat-pill-text`) with the prompt "This needs a category" (only on-budget, non-split, amount ≠ 0) |
| error | regular | pill (`--error-pill-bg`, `--error-pill-text`), category struck through |
| shown only for context in search | struck through `--text-strike` | |

### 2.2 Category cell display

"{Group}: {Category}". Income categories show "Income: {Category}". Splits show "Split (Multiple Categories)..." with an expand/collapse arrow. On-budget↔on-budget transfers show "(Category not needed)" in gray. Off-budget accounts show nothing.

## 3. Toolbar

| Control | Behavior |
| --- | --- |
| **Edit Transactions ▾** | First toolbar button. Label: "Edit Transactions" (0 selected, disabled), "Edit (1) Transaction ", "Edit ({n}) Transactions ". Opens the actions menu (§6). |
| **Add** | Second toolbar button, with a plus icon to the left of the text. Opens a new inline transaction editor as the grid's first row, above the transactions, scrolled into view. Disabled offline (`03` §5.3); it stays focusable with `aria-disabled="true"` so its tooltip can be read (`22` §4.6). |
| **Transfer** | Third toolbar button, with a transfer icon to the left of the text. Opens a new inline transaction editor with "Transfer:" prefilled in Payee and the payee list open. Shown only when an open account other than the new transaction's account exists (in All Accounts, the account it would default to, `11` §2), as the scheduler pane's **Transfer** (`12` §3). Disabled offline like **Add**. |
| **Import** | Fourth toolbar button. Bank import for this account (`16` §1). Disabled offline and in All Accounts. (In All Accounts, File ▸ Import Transactions from Your Bank… still works, with no default target account, `16` §1.1.) Hidden while reconciling (`13` §6.2). |
| **Reconciled filter** | First control in the right-aligned filter group. Two-segment toggle: "Show reconciled transactions" / "Hide reconciled transactions". Disabled while the register is filtered (search text, a date filter ≠ All Dates, or reconciling). Disabled tooltip "Both reconciled and unreconciled transactions are shown while searching". Saved per account. |
| **Date filter** | Second control in the right-aligned filter group. Drop-down labelled with the current option (default "All Dates"; a From/Through range reads "{from} - {through}", short month and year) → **Timeframe** callout (opens below the button, `placements: ['topRight', 'top', 'topLeft', 'bottomRight', 'bottom', 'bottomLeft']`, `17` §3 "Placement rules"; its right-side placement follows from its position near the toolbar's right edge): presets **This Month**, **Latest 3 Months**, **This Year**, **Last Year**, **All Dates**; **From:**/**Through:** month pickers (range = the account's first to last transaction month); Cancel / Done. Filtering is by **month** (inclusive). Saved per account. |
| **Search box** | Last control in the right-aligned filter group. Prompt "Search {Account name}" ("Search" in All Accounts). Min width 15 rem. It grows to 100% (min 23 rem) over 300 ms on focus or while a filter is active. It shrinks back on blur only if empty and the date filter is All Dates. Auto-complete drop-down (27 rem wide, `--row-h` rows, up to 20 visible, then it scrolls) offers filter tokens (§4). Ctrl+F focuses it. Enter or comma commits a token. Esc (drop-down closed) clears the text if a search is applied, otherwise cancels, which also clears the date filter if one is set. |

## 4. Search language (`src/shared/search/`)

The search text is a comma-separated list of terms, and **all** terms must match (AND). Keywords (text before the first colon) are case-insensitive. Terms of the same kind for **Payee / Category / Account / Tag** are OR-ed (`Payee: Kroger, Payee: Walmart` = either). In locales whose decimal separator is a comma, a comma between two digits is a decimal point, not a separator.

| Term | Meaning |
| --- | --- |
| `text` (no colon) | case-insensitive *contains* in payee, category, notes or check number. If numeric, it also matches outflow/inflow equal to the value. Also tested against split lines (payee → transfer account text; check number not tested). |
| `Payee: x` | if x equals an existing payee name (case-insensitive) → exact match; otherwise payee contains x. Split lines are tested by their transfer text (or the parent payee). Empty value = no payee. |
| `Category: x` | if x equals an existing "Group: Category" (case-insensitive) → exact match; otherwise contains (against the display name). Empty value = uncategorized. |
| `Account: x` | account name contains x. Special values: "Budget Accounts", "Off-Budget Accounts", "Closed Accounts", "Closed Budget Accounts", "Closed Off-Budget Accounts". |
| `Notes: x` | notes contain x |
| `Check: x` | check number contains x (empty = no check number) |
| `Tag: name` | exact, case-sensitive tag match |
| `Is: Approved` / `Is: Unapproved` | review tag absent / present |
| `Is: Error` / `Is: Reminder` / `Is: NeedsCategory` | error level |
| `Is: Cleared` / `Is: Uncleared` / `Is: Reconciled` / `Is: Cleared or Reconciled` / `Is: Unreconciled` | cleared state |
| `Is: Expense` | not an income-category transaction and not a transfer (on↔off-budget transfers count) |
| `Is: Income or Expense` | any non-transfer (or on↔off-budget transfer) |
| `On: date`, `After: date`, `Before: date` | exact / on or after / on or before (date parsed with `11` §3 rules) |
| `Outflow: 12.34`, `Outflow: >12`, `Outflow: <12` | equals / ≥ / ≤ |
| `Inflow: …` | same |
| `Income: January 2026` | transactions in an income category dated in that month |
| unknown `x: y` | free-text search for "y" |

`Is: Expense` and `Is: Income or Expense` are not offered in the drop-down. The parser still accepts them, and the budget's total Outflows popover writes `is: Expense,` (`09` §6.6).

**Languages** (`20` §3.8). The table above uses the English words. Every word of the search language is an i18n key in the `search` bundle: the keywords (`Payee`, `Is`, `On`, …), the `Is:` values (`Cleared`, `Error`, …), the special `Account:` values, the operator word `or`, and the month names in `Income:` (from the date-fns locale). Tag names are user data and are matched exactly as written, case-sensitively.

- The parser accepts the UI language's words **and** English, case-insensitively. When a word means different things in the two languages, the UI language wins.
- Drop-down suggestions, programmatic searches and the info bar use the UI language.
- A search typed in English always works, whatever the UI language. When the language changes, a search already in the box keeps its text, and English words in it keep matching.
- Values the user typed (payee, category and account names, notes text) are matched as typed. They're data, not search words.

**Drop-down suggestions** (HTML rows), in order:

1. dates — a "Dates" header with the hint "(*Enter dates as {format}*)", then "On **{value}**", "On or before **{value}**", "On or after **{value}**";
2. accounts (All Accounts view only);
3. amounts — "Outflow equals **{value}**", "Outflow more or equal to **{value}**", "Outflow less or equal to **{value}**", and the same three for Inflow;
4. "Income:" with the hint "(*Enter month like 'Income: {current month}'*)";
5. tags matching the typed name;
6. "Is: Approved"/"Unapproved";
7. "Is: Cleared"/"Uncleared"/"Reconciled"/"Cleared or Reconciled"/"Unreconciled";
8. matching payees;
9. matching categories;
10. "Find "**{value}**" in any field", "… in the payee", "… in the category", "… in the notes", "… in the check number";
11. "Is: Error"/"NeedsCategory"/"Reminder".

In All Accounts, accounts come before Income and amounts after it.

**Splits:** a split parent is shown if it or any line matches. Lines that don't match are shown struck through for context. While searching, a split is auto-expanded whenever the parent or any of its lines does *not* match. The expand/collapse state and scroll position from before the first search are restored when the search is cleared. **Search Total** counts only matching lines of splits.

**Search info bar** (`--control-h`; slides open over 250 ms while filtered; dark background, white text):

- "Showing {n} results" + `for "{search}"` (if there's search text) + `during "{date option}"` (if date ≠ All Dates). A trailing comma in the search text is dropped.
- While reconciling: "Showing {n} transactions " + `for "{search}"` + "on or before {date} (statement date)".
- Right: **Clear Search** (search text or reconciling) or **Clear Date Filter** (date only), with a cancel icon. Hidden while reconciling with an empty search.

**Programmatic searches** set the text, written with the UI language's search words (the English forms are shown here): `is:Error,` / `is:Reminder,` / `is:NeedsCategory,` (notifiers), `is:Cleared or Reconciled` / `is:Uncleared` (footer boxes), `Category: {name},`, `Income: {Month YYYY},`, `Payee: {name},`, `is: Expense,` (popovers), `Payee: {name},` (Payee Settings).

Implementation: the parser produces `Predicate<RegisterRow>`. Filtering runs in the renderer over the loaded register data (Vue Query `['register', accountId]`). Unit-test the parser exhaustively.

## 5. Notifier strip

Shown above the toolbar only when relevant. Each notifier is a pill with an icon, text and a "Show" link. Clicking it applies the search `is:Error,`, `is:NeedsCategory,` or `is:Reminder,`.

| Notifier | Color | Full text | Short text (narrow strip) |
| --- | --- | --- | --- |
| Error | `--notifier-error-bg`, `--notifier-error-border` | "1 transfer to an on-budget account has a category" / "{n} transfers to on-budget accounts have categories" | — |
| NeedsCategory | `--needscat-row-bg`, `--needscat-row-border` | "1 transaction needs a category" / "{n} transactions need a category" | "1 Warning" / "{n} Warnings" |
| ForReview | `--review-row-bg`, `--review-row-border` | "1 transaction needs approval" / "{n} transactions need approval" | "1 Reminder" / "{n} Reminders" |
| Undo | `--register-gray-bg`, right-aligned, always full text | "Deleted 1 transaction" / "Deleted {n} transactions" / "Moved 1 transaction to '{account}'" / "Moved {n} transactions to '{account}'" | link "Undo" |

Clicking anywhere on the Undo notifier performs the undo, and so does Ctrl+Z while it shows, with focus in the register but not in a text field (§9; a text field keeps Ctrl+Z for its own undo, `06` §4). Any mouse-down elsewhere, navigation or a new edit hides it (the undo token is then discarded).

## 6. Transaction actions

### 6.1 Actions menu

Opened from **Edit Transactions ▾** or by right-clicking a row that isn't being edited. Right-clicking selects the row if it isn't selected, and adds a disabled title "1 selected transaction:" / "{n} selected transactions:" plus a separator. Native context menu. Every item that mutates is disabled offline.

```text
Mark as Cleared                 (enabled if any selected is Uncleared)
Mark as Uncleared               (enabled if any selected is Cleared)
──────────
Approve                         (enabled if any selected needs review)
Reject (Delete)                 (same)
──────────
Categorize As ▸                 (on-budget account or All Accounts) {Group} ▸ {Category}… for every group incl. Income, then (No Category)
──────────
Rename like payees...           (exactly 1 selected, non-empty, non-transfer payee)
Payee settings...
Create a new rule...            (exactly 1 selected)
──────────
Make recurring...               (exactly 1 selected)
Move to scheduler...            (exactly 1 selected, dated after today, not a transfer line of a split)
──────────
Change Date...                  (2 or more selected; not while reconciling) (X25)
Move to account ▸               (open accounts except the current one, by name; disabled if none, or if every selected one is a transfer a split created)
──────────
Match                           (exactly 2 selected, same account, same amount)   (X4)
──────────
Delete
```

Behaviors:

- **Mark as Cleared/Uncleared**: never changes Reconciled transactions. Clearing also approves (removes the review tag), as in the reference design.
- **Approve** (also V, §9): removes `#needs-review` from the selected transactions (and from the other side of transfers). If the selected row is being edited, the editor then moves to the next unapproved transaction.
- **Reject (Delete)**: deletes the selected for-review transactions through the normal delete flow (§8).
- **Categorize As**: sets the category on all selected non-split transactions ("(No Category)" clears it). If splits are selected: TaskDialog "The selected split transaction(s) will not be recategorized." / "Split transactions cannot be recategorized in bulk. The {n} selected split transactions will be skipped by this operation." with Cancel / **Continue categorizing**. Categorizing on-budget↔on-budget transfers is refused silently (they're skipped).
- **Rename like payees…** → Rename Payee dialog (`14` §3.1), pre-filled.
- **Payee settings…** → Payee Settings with the first selected transaction's payee.
- **Create a new rule…** → the rule editor, pre-filled from the transaction (`23` §2.2).
- **Make recurring…** → the Schedule dialog pre-filled from the transaction, Monthly (`12` §4). After **Add**, the new schedule is selected in the scheduler pane (opened if hidden).
- **Move to scheduler…** → the same dialog with Repeats off, on the transaction's date (`12` §4). **Add** deletes the original without confirmation or Undo; Cancel leaves it.
- **Change Date…** (X25; an addition to the reference design) sets the same date on every selected transaction.
  - **Availability:** enabled with 2 or more transactions selected, and online. With 1 selected it is hidden: the date is edited in the row. It is hidden while reconciling, where the list is bounded by the statement date (`13` §6.2). Split lines are not transactions of their own and count as their parent; selecting a parent and its lines changes the parent once.
  - **Dialog:** a TaskDialog titled "Change the date of {n} transactions?" with one date field in the budget's date format (`19` §1), the same field and parser as the editor's Date cell (`11` §2). It starts empty, with the placeholder showing today's date, and takes keyboard entry or a calendar pick. Any valid date is accepted, past or future. Buttons **Change Date** (default, disabled until the field holds a valid date) and Cancel.
  - **What changes:** only `date`. Payee, category, notes and tags, check number, review state and cleared state are untouched. A split's lines take the parent's new date (they have none of their own). As in the editor (`11` §6 step 6, "Transfer date"; `04` §3), the other side of a transfer, and the other side of each transfer line of a split, takes the new date in the same job, because Actual doesn't propagate dates. Selecting both sides of a transfer changes the pair once.
  - **Reconciled transactions:** as for **Move to account** and `11` §6. If more than one selected is reconciled, warning "Not all of these transactions can be changed" / "Some of these transactions have been reconciled, so you will need to change the date of any already reconciled transactions individually" (Close), and nothing changes. Exactly one reconciled → the editor's question for a date change (`11` §6 step 2): "Reconciled Transaction" / "This transaction has already been reconciled. Modifying its date may bring the reconciliation out of balance.\nDo you still want to save this change?", footer "Changing a Reconciled Transaction", buttons "Yes, make this change" / "No, cancel this change" (default). On yes, as in the editor, it becomes Cleared if the new date is after its account's last reconciliation date (`13` §6); otherwise it stays Reconciled. Its own reconciled other side follows the same rule against that side's account, without a second question. Then, if the other side of another selected transfer (or of a selected split's transfer line) is reconciled and isn't itself selected, the editor's question (`11` §6 step 2) is asked once for the whole selection: "Reconciled Transaction" / "The other side of this transfer has already been reconciled. Modifying the date may bring the reconciliation out of balance.\nDo you still want to save this change?", footer "Changing a Transfer to a Reconciled Transaction", same buttons. No → nothing changes. Yes → as in the editor, each such other side becomes Cleared if the new date is after its account's last reconciliation date (`13` §6); otherwise it stays Reconciled.
  - **Write:** `transactions.setDate(ids, date, clearReconciled?)` (`03` §8; `clearReconciled` lists the reconciled transactions and other sides that become Cleared, as decided above) is one write job, checked by the write gate, that applies every update through the settling wrappers (`03` §3) and fails as a whole: after a failure, every transaction and other side it already changed gets its old date back; the error is shown as for other bulk actions. If that rollback fails too, the host fails with `details.code: 'partial-change'` and the dialog says so: "Something went wrong" / "Some of the {n} transactions may have been given the new date, and putting the others back failed. Check the dates in the register, then try again."; the register is refreshed and no Undo notifier is shown. The date is stored as `'YYYY-MM-DD'` with no time zone (`04`). Actual's rules don't run on updates (`12` §2), so a changed date neither links a transaction to a schedule nor rewrites its fields. The host emits `data:changed { tables: ['transactions'] }`.
  - **After it:** an Undo notifier "Changed the date of 1 transaction" / "Changed the date of {n} transactions" with **Undo** (the `moved` notifier's behavior, `10` §5): it restores the previous date of each transaction and each other side it changed, and the Reconciled state of any transaction or other side it made Cleared, with the same ids (nothing is re-created). The selection stays. The grid re-sorts as after any commit, so rows can jump (§2); the first changed row is scrolled into view if the new order moved it off-screen. Running balances are recomputed (§7.4).
  - **Filters:** rows moved outside the active date filter leave the view, as with any edit; the notifier remains.
- **Move to account**: blocked if any selected transaction is (or contains) a transfer into the target account: warning "Not all of these transactions can be moved to account '{account}'" / "At least one of these transactions is a transfer transaction into account '{account}', so none of the transactions will be moved" (Close). Blocked if any is a transfer created by a split in another account (same title; "At least one of these transactions is a transfer from a split transaction, so none of the transactions will be moved. You must change its account from within the split transaction."): Actual would retarget the split's line to the new account, changing the split from another account's register. Like delete (§8), it's changed from the split; the host refuses it too (`split-transfer-locked`). Blocked if more than one is reconciled (same title; "Some of these transactions have been reconciled, so you will need to move any already reconciled transactions individually"). Exactly one reconciled → warning "Reconciled Transaction" / "This transaction has already been reconciled. Modifying its account will bring the reconciliation out of balance.\nDo you still want to make this change?", footer "Changing a Reconciled Transaction", buttons "Yes, make this change" / "No, cancel this change" (default). Moved reconciled transactions become Cleared. The Undo notifier restores the account and cleared state, and the categories a move to an off-budget account cleared (the transaction's and a split's lines').
- **Match** (X4) → TaskDialog "Merge these two transactions?" / "Actuality will combine them into one transaction. The imported transaction is kept and any empty fields are filled in from the other one. This can't be undone." **Merge** / Cancel → `transactions.merge(a, b)` (Actual keeps the imported one, otherwise the earlier one; it fails for different accounts or amounts, or transfers to different accounts, and the error message is shown). The result gets the review tag and is selected.
- **Delete** (also the Delete key; Backspace on macOS): §8.

### 6.2 Tags in the register

Each tag in Notes is shown as a colored text pill with its `#name` (`04` §5.1–5.2). Clicking a pill filters the current register to transactions with that exact tag (`Tag: name`, §4). Tags are user data and remain visible by name in every palette.

### 6.3 Error column popovers

| Level | Popover |
| --- | --- |
| needsCategory | "Choose category for selected transaction" / "Choose category for {n} selected transactions": a category list (income + expense). Done applies it to all selected needs-category transactions. Width 27 rem. |
| forReview | "1 selected unapproved transaction" / "{n} selected unapproved transactions": options "Approve Transaction"/"Approve Transactions", "Delete Transaction"/"Delete Transactions". Width 24.5 rem. |
| error | "1 selected transfer transaction" / "{n} selected transfer transactions": option "Remove Budget Category" / "Remove Budget Categories" (clears the category on the offending transactions/lines). Width 22 rem. |

### 6.4 Cleared cell

Click (it selects the row first, unless an edit has unsaved changes). With one row: toggles Uncleared ↔ Cleared, and approves when it becomes Cleared. With several selected: if all non-reconciled ones are Cleared → set Uncleared, else set Cleared and approve. Reconciled can't be toggled. Tooltips:

- Uncleared: "This transaction is marked as 'Uncleared', meaning that your bank doesn't know about it. Click to mark it as 'Cleared'."
- Cleared: "This transaction is marked as 'Cleared', meaning your bank knows about it. Click to mark it as 'Uncleared'"
- Reconciled: "This transaction is marked as 'Reconciled', meaning that your bank knows about it and it has been reconciled with your bank statement."

Icons: uncleared = outline "C" in `--cleared-off`; cleared = filled "C" in `--cleared-on`; reconciled = lock. The glyph shapes differ, so the state never depends on color alone (`05` §1.5).

## 7. Footer

### 7.1 Scheduled Transactions toggle

A `--control-h-lg` button "Scheduled\nTransactions" with a clock icon and a count badge (this account's schedules; hidden when 0). Tooltip "Show Scheduled Transactions" / "Hide Scheduled Transactions". Expanding animates the pane to max(saved height, 14.25 rem). Collapsing saves the height and animates to 0 (300 ms). Saved per account. Reconciling hides the pane, and leaving reconciliation restores it.

### 7.2 Summary box

Three panels (sized to their content; the middle one about 20% wider) with `+` and `=` between them (`md`):

| Default | Alternate |
| --- | --- |
| **Cleared Balance**, tooltip "Total of cleared and reconciled transactions. Click to display these transactions." (click → `is:Cleared or Reconciled`) | **Selected Total ({n})** when 2+ rows are selected (tooltip "Total of all selected transactions"; takes priority). Blank while a search is active. |
| **Uncleared Transactions**, tooltip "Total of uncleared transactions (these haven't yet cleared your bank). Click to display these transactions." (click → `is:Uncleared`) | **Search Total ({n})** while searching ("This is the total of all transactions found in the current search"; takes priority). Blank when 2+ rows are selected. |
| **Working Balance**, tooltip "This is the actual money you have available in this account based on both Cleared and Uncleared transactions." | — |

The operators become vertical dividers (1 px wide, the panels' height, `--summary-divider`) unless both panels show their default content. Panels slide up/down (750 ms ease-out) when switching. Amounts have the currency symbol: `--text-strong`, negative `--money-negative-strong`.

### 7.3 Reconcile Account button

A `--control-h-lg` "Reconcile\nAccount" button. Disabled in All Accounts (tooltip "Please select an account on the sidebar to reconcile"; a pointer-down shows a help callout on the sidebar's Budget Accounts group: "You can't reconcile from the All Accounts view.

Please select the account you want to reconcile first."). Disabled offline. Starts reconciliation (`13` §6). While reconciling, the **Reconciling title** "Reconciling {account}..." is shown on its own line below the account header (§1); it's a separate element, and the header doesn't change.

### 7.4 Running balance tooltip

The running balance is computed from the account's full, unfiltered transaction list, including rows hidden by search, date filters, reconciled filters, or reconciliation mode. Its order is derived only from the Date, Outflow and Inflow sort settings, not from the complete display order:

1. Date is the primary calculation key. Use the selected Date sort direction, or Date descending when Date is not among the user's sort keys. To accumulate actual account balances, process dates chronologically (ascending); the selected Date direction determines the date ordering preference but does not reverse the accumulation from oldest to newest.
2. Within each date, use the active Outflow and Inflow keys in their relative selection order, each in its selected direction. Append any missing key using its balance default: Outflow descending and Inflow ascending. If neither is selected, use Outflow descending, then Inflow ascending. This places larger outflows first and larger inflows last. For example, Inflow ascending alone means Inflow ascending, then Outflow descending; Outflow ascending alone means Outflow ascending, then Inflow ascending.
3. Ignore all other display sort keys when calculating balances. Recalculate the transaction-to-balance mapping whenever the Date, Outflow or Inflow sort setting changes. A sort change to another column can reorder the rows, but does not change their balances. Therefore, the balance column may not progress consistently from top to bottom in a non-date sort.

Examples of the normalized balance sort keys:

| User's active sort keys | Balance sort keys |
| --- | --- |
| None of Date, Outflow or Inflow | Date descending → Outflow descending → Inflow ascending |
| Date ascending | Date ascending → Outflow descending → Inflow ascending |
| Outflow descending | Date descending → Outflow descending → Inflow ascending |
| Outflow ascending | Date descending → Outflow ascending → Inflow ascending |
| Inflow descending | Date descending → Inflow descending → Outflow descending |
| Inflow ascending | Date descending → Inflow ascending → Outflow descending |
| Date, Outflow and Inflow in a multisort | Date first (selected direction or descending if absent), then Outflow and Inflow in their relative selection order and selected directions |

Any other active sort keys are ignored when deriving this order. For example, Payee → Inflow → Outflow gives Date descending → Inflow (selected direction) → Outflow (selected direction) for balance calculation.

"Balance through {date}:" with lines "Cleared Balance (Your bank balance as of {date})", "Uncleared Total (Transactions the bank doesn't know about)", "Working Balance (Money you actually had on {date})".

## 8. Deleting & undo

- The Delete key (Backspace on macOS) with rows selected (not while editing or with focus in search) deletes them. If focus is in the scheduler pane, it deletes the selected schedules instead (no confirmation, no undo).
- A confirmation is shown only when there's something to warn about. Title "Delete 1 transaction?" / "Delete {n} transactions?". Messages are joined by blank lines in this order:
  - "1 of the selected transactions has been reconciled. " / "{n} of the selected transactions have been reconciled. " + "Deleting a reconciled transaction will bring the reconciliation out of balance"
  - "1 of the selected transactions is a transfer where the other side has been reconciled. " / "{n} of the selected transactions are transfers where the other side has been reconciled. " + "Deleting a reconciled transfer will bring the reconciliation out of balance"
  - Transfer lines created by a split elsewhere can't be deleted here: "One of the transactions selected for deletion is a transfer from a split transaction. This transaction will not be deleted. You must delete this transaction from within the split transaction." / "{n} of the transactions selected for deletion are transfers from a split transaction. These transactions will not be deleted. You must delete these transfer transactions from within the split transaction." If *all* selected are such: dialog "Could not delete transaction(s)" with the "All of the transactions…" variant and Close.
  - "1 of the selected transactions is a transfer. " / "{n} of the selected transactions are transfers. " + "Deleting a transfer will delete its counterpart transaction in another account." Split transactions with transfer lines count here too.
  - Buttons: Cancel / **Delete Transaction** / **Delete Transactions** (default).
- **Split transfer lines:** deleting a split parent makes Actual *unlink* the mirrors of its transfer lines rather than delete them (`04` §3). The host deletes those mirrors itself, in the same job, so the result matches the reference design: deleting a split deletes all its transfer counterparts.
- **Undo (app-level):** before deleting, the host snapshots each deleted transaction, its splits and its transfer counterpart (full field set, including `rawNotes`, `cleared`, `reconciled`, `imported_id`). `transactions.undo(token)` re-creates them with **new ids**. showed that Actual silently drops a create that reuses a deleted id.
  - Normal transactions and splits are re-created with `addTransactions(acct, [...], { runTransfers: true })`, with the snapshotted fields and `cleared` set explicitly.
  - A transfer is re-created **once**, from the side that was deleted (or the first one selected), through its transfer payee. Actual creates a new mirror.
  - A split is re-created with its transfer lines, so Actual creates a new mirror for each line. The mirrors the host deleted (above) are not re-created separately.
  - In the same job, the host then restores each mirror's own snapshotted `date`, `cleared`, `reconciled` and `category`, which Actual doesn't take from the source. The category matters for the on-budget side of an on↔off transfer, which has its own.
  - The undo token maps old ids → new ids, so the re-created rows can be re-selected. The Undo notifier ("1 Transaction has been deleted" / "{n} Transactions have been deleted") lasts until the next mouse-down elsewhere. Undo needs `canEdit`: an undo refused offline keeps its token, and the notifier shows again after the offline dialog so it can be retried.

## 9. Selection & keyboard (grid not in edit mode)

| Input | Action |
| --- | --- |
| Click row | Selects it. Clicking the row when it's already the **only** selected row (no modifier) **starts editing** the clicked cell. If an edit has unsaved changes, clicking outside it is blocked and the editor's button row glows blue. |
| Ctrl/Cmd+click, Shift+click | Ctrl/Cmd+click toggles a row in the selection. Shift+left-click selects the inclusive range from the selection anchor to the clicked row; this also applies when clicking a row's checkbox. |
| Header checkbox | With no rows selected, selects all rows. With all rows selected, clears the selection. With some but not all rows selected, shows an indeterminate (horizontal dash) icon; clicking it clears the partial selection. |
| Ctrl+A | select all; when every row is already selected, clear the selection (not editing, search not focused) |
| Enter or F2 | edit the single selected transaction (or the selected schedule) |
| Ctrl+N, or T | add a new transaction (opens a new inline transaction editor) |
| Ctrl+Shift+C, or L | toggle cleared on the selection (Ctrl+Shift+C also on the transaction being edited or added, `11` §9) |
| Ctrl+F | focus search |
| Delete (Backspace on Mac), with or without Ctrl, or D | delete the selection |
| Ctrl+Z | while the Undo notifier shows, undo (§5) |
| F5 | re-apply the sort (both grids) |
| Shift+click (or Shift+Enter) on a header | add the column as a sort key, or cycle its direction / remove it (§2) |
| ↑/↓, or J/K | move the selection down/up (Shift extends) |
| Right-click row | actions menu |

Enter/F2, Delete, ↑/↓ and the single-letter keys act only with focus in the grid (or on no control at all). With focus in the toolbar, the footer or the scheduler pane they do nothing to the selection, so D or Delete on a toolbar button can't delete transactions. Ctrl+N, Ctrl+F, Ctrl+A, Ctrl+Shift+C, Ctrl+Z and F5 work anywhere in the panel outside a text field.

**Single-letter keys** work with focus in the grid, never in a text field (`06` §6), and only without Ctrl, Alt or Shift (Shift only extends J/K). They match Actual's own register keys, so people moving from Actual keep their habits. Most run an actions menu item (§6.1), with the same rules: nothing happens when the menu would show the item disabled or leave it out (so offline, nothing that changes data runs). An item with a submenu shows just that submenu, as a native menu at the pointer.

| Key | Action |
| --- | --- |
| T | add a new transaction, as Ctrl+N |
| E | **Change Date…** with two or more selected; with one, edit it starting in Date |
| P / N | edit the single selected transaction, starting in Payee / Notes |
| M | edit the single selected transaction, starting in Inflow for a deposit, otherwise in Outflow |
| C | **Categorize As ▸** (its submenu) |
| A | **Move to account ▸** (its submenu) |
| L | toggle cleared, as Ctrl+Shift+C |
| V | **Approve** |
| S | **Make recurring…** |
| G | **Match** |
| D | delete, as Delete |
| J / K | move the selection down / up, as ↓ / ↑ |

Actual's other register keys have no equivalent here: F (show only the selected transactions, or the filter menu), U (duplicate), R (make a transfer from two transactions), Space and Shift+Space (selection by a current-row cursor separate from the selection), and P, N and M acting on several transactions at once.

### 9.1 Jump to transaction

Used from popovers and the transfer icon. It navigates to the transaction's account (or stays in All Accounts if that's showing). It clears the search/date filter only if they'd hide the transaction, and turns on show-reconciled if it's reconciled. Then it selects the row and scrolls it into view. A split line jumps to its parent, which is expanded.

## 10. Per-account view state

Saved per budget/device, keyed by **account id** (`19` §2): column settings for both grids, sort for both grids (the register's is a list of up to 4 keys, §2), date filter (label/start/end), `showReconciled`, `schedulerVisible`, `schedulerHeight`. In memory per session: scroll position (−1 = bottom), selection, search text, reconciliation in progress, and the last date used for a new transaction.

**Writing it (the register must come back as the user left it after a screen switch, an added transaction or a sync).** The saved view state lives in the renderer's `budgetSettings` store, a mirror of `budgets/{cloudFileId}.json` that main owns (`19` §2).

- A change is a patch that replaces a whole top-level key (`register`), so it must be built from the settings **as they are when it is sent**. Patches are therefore **serialized** (one in flight at a time, in call order) and built by an updater function that receives the current settings. A patch built from an earlier snapshot would undo a change made since, for example a column drag firing several patches, or a patch racing the `lastScreen` write that every navigation makes.
- A patch holds plain data only (no reactive proxies).
- The mirror takes main's answer to each patch and its change notifications (the host also writes `localId` and `lastSyncAt` after a sync). If a write fails, the mirror is reloaded from main, so the screen never shows a change that is not on disk, one that the next notification would silently revert.
- The register reads every saved value only through the store, never from a copy kept in a component, so a remounted register shows the saved state.

## 11. Acceptance criteria

1. 20,000-transaction account: opens < 1.5 s, scrolls at 60 fps, search filters < 200 ms (`21` §5).
2. Every search term in §4 has unit tests, including OR-ing within kinds and comma-decimal locales.
3. Running balance is correct under filters and every display sort. It is computed from the unfiltered transaction list using the normalized Date → Outflow/Inflow calculation order (§7.4): Date defaults to descending when not selected; within each date, selected Outflow/Inflow keys retain their relative selection order and direction, and missing keys default to Outflow descending and Inflow ascending. Accumulation still proceeds chronologically. Changing Date, Outflow or Inflow sorting recalculates the mapping; other sort keys do not affect balances. Tests cover hidden filtered/reconciled transactions, each single-column case, Outflow/Inflow key ordering in multisort, and non-amount display sorts.
4. Deleting a split with a transfer line removes the split and the mirror in the target account (no orphaned row is left). Undo then restores all three records (with new ids) and both balances.
5. In offline mode, all mutating controls are disabled and read-only features still work.
6. Change Date… (§6.1): with 2+ rows selected it sets the date on all of them and nothing else (including a split's lines and a transfer's other side, as the editor does); it is refused offline by the write gate (integration test); more than one reconciled row blocks it; a reconciled other side asks first; Undo restores every date; running balances stay correct after the re-sort.
7. Multisort (§2): the comparator has unit tests for mixed directions, a repeated column, the tie-break chain skipping columns that are keys, the chain taking the primary key's direction, and same-date amount ordering (largest outflow first, largest inflow last) regardless of Date direction. Shift+click adds, cycles and removes keys, with a cap of 4; a plain click resets to one key; the saved keys survive a screen switch and a restart; a saved single `mainSort` object loads as one key; unknown or duplicate saved fields are dropped; reconciliation ignores the keys and restores them afterwards; the Scheduled Transactions pane is unaffected.
