# 11 — Transaction Entry & Editing (Inline Editor)

Transactions are created and edited **inline in the register grid**. The clicked row turns into an editor row with inputs aligned to the columns, followed by a button row. Schedules are not edited inline: the scheduler pane opens the Schedule dialog (`12` §3.1), which reuses this chapter's payee, category, split and notes behavior. Opening the editor requires `canEdit` (`03` §5.3).

Component: `<TransactionEditor>`, bound to an `EditableTransaction` (a deep clone). The stored transaction is never changed until the commit pipeline (§6) succeeds.

## 1. Edit lifecycle

1. **Begin**:
   - click a row that is already the *only* selected row (no modifier); clicking an unselected row only selects it;
   - press Enter/F2 on the single selected row;
   - **Add** / **Transfer** in the register toolbar ("Transfer" pre-fills `Transfer:` and opens the payee list);
   - Ctrl+N.

   **An edit already open** is handled by one rule, everywhere (`06` §3, §5, `10` §9):
   - *Unchanged* (no field differs from the stored transaction): any other action silently cancels it first.
   - *Changed*: a click on another row or anywhere outside the editor is blocked, and the editor's button row glows blue (`10` §9). Actions that leave the edit another way run the commit pipeline (§6) first. These are a keyboard-started new edit (Enter/F2, Ctrl+N, the Add and Transfer toolbar buttons), switching account or screen, starting a search, and quitting. If the commit fails or is cancelled, the action doesn't happen and the editor stays open.
2. Focus goes to the control under the pointer (the Date field for keyboard-started edits).
3. **Commit**: **Done**, **Save**, Enter (= default button), Ctrl+Enter (§9) or the approve buttons → §6. For a new transaction, saving with no check #, payee, category, notes and amount just closes the editor.
4. **Cancel**: the **Cancel** button or Esc. The first Esc reverts the *focused field* if it changed. A second Esc (field unchanged) cancels the whole edit. Leaving the edit by other means follows the rule in step 1.
5. One edit at a time per grid. While a modal dialog is open, commit and cancel requests are refused.

Visuals: 1 px `--row-edit-border`, background `--row-edit-bg`. Inputs are borderless, separated by the column borders. Gray placeholders: "payee", "category", "notes", "outflow", "inflow".

## 2. Editor controls (by column)

| Column | Control | Details |
| --- | --- | --- |
| Select | checkbox (disabled while editing) | |
| Account (All Accounts only) | auto-complete over open accounts | must match an account, otherwise it reverts on blur. A transfer line *created from a split elsewhere* can't change its account here (the host refuses it too, `split-transfer-locked`): "This account cannot be changed" / "This transaction is a transfer from a split transaction, so its account cannot be changed. You can modify this transaction from the side of the split transaction.", and the field reverts. New transactions in All Accounts default to the first open account in sidebar order (on-budget first). "Save and add another" keeps the account just used. |
| Date | `<DateField>` | §3 |
| Check # | text | ↑ or `+` increments, ↓ decrements (minimum 1). On an empty field, ↑/↓/`+` enter the next number. Alt+N / Ctrl+Shift+N enters the account's *next* check number (the most recent positive numeric check # in the account + 1, via `transactions.nextCheckNumber`). Trimmed; empty → none. Stored as the notes token (`04` §5.1). |
| Payee | `<AutoComplete>` | §4.1 |
| ! | error icon | click → resolution popover (`10` §6.3) |
| Category | `<AutoComplete>` | §4.2. Not shown for off-budget accounts. |
| Notes | text | |
| Outflow / Inflow | `<MoneyInput>` with calculator | The transaction holds one signed amount. Committing either field sets the amount (inflow = +value, outflow = −value) and clears the other. Then if `amount ≥ 0`, inflow shows the value and outflow is blank, else the reverse (so a negative outflow becomes an inflow). Locale-aware decimal input. `+ - * /` open the calculator (`09` §5.4). A transfer line *created from a split elsewhere* can't change its amount here: "You can't change this transaction amount." / "This transaction is a transfer from a split transaction. You must change this inflow/outflow cell value from within the split transaction." |
| Running Balance | read-only | |
| Cleared | toggle | Uncleared ↔ Cleared (also approves) |

**Tab order:** Account → Date → Check # → Payee → Category → Notes → Outflow → Inflow → **Cleared** → (split lines: payee, category, notes, outflow, inflow each) → (buttons), then wrap. The Cleared toggle is a real button in the tab order (it is keyboard-operable like everything else the mouse can do, `22` §2): Space or Enter toggles it with the same rules as a click (`10` §6.4), and Enter on it doesn't press the default button. While the transaction is Reconciled it stays focusable but disabled-toggle (announces "Reconciled"). Notes accepts tags as ordinary note text: when typing `#`, offer matching managed tags; Enter or Tab accepts a suggestion, and an unknown valid tag can still be entered. **Special rule:** if the category is an *income* category, Tab from Notes skips Outflow and goes to Inflow (also in split lines). Committing a payee or category with Enter/Tab moves focus to the next control.

**Button row** (right-aligned under the editor; the **first** button is the default for Enter):

| Situation | Buttons |
| --- | --- |
| Existing, approved | **Done**, Cancel |
| Needs review (imported / entered by the scheduler) | **Approve and find next**, Approve, Delete, Cancel |
| New transaction | **Save and add another**, Save, Cancel |

Buttons are `--control-h-sm` tall, 600 `body`, pill-shaped, gap `--space-2`. Save and add another, Save, Done, Approve and find next and Approve are green (`tone="save"`, `--button-save-bg`); Delete and Cancel are red (`tone="cancel"`, `--button-cancel-bg`). Both have a white `--button-tone-text` label, and the CVD palettes make them blue and orange (`05` §1.8). While a commit is in progress every button is disabled and shows the standard disabled look. "Approve and find next" approves, commits, then opens the next needs-review transaction in the current sort order (wrapping to the top).

## 3. Date field (`<DateField>`, `src/shared/dates.ts`)

- Displays the budget's short date format (`dateFormat`).
- Loose parsing: the separators `/. - '` (or the locale separator) are interchangeable. Without separators: 6 digits = three 2-digit parts; 8 digits = `MMDDYYYY`/`DDMMYYYY` (or `YYYYMMDD` for year-first formats). A missing year → the current year. Two-digit years: `> 70` → 19xx, else 20xx. The order (MDY / DMY / YMD) follows `dateFormat`.
- Keyboard (Quicken-style):

  | Key | Effect |
  | --- | --- |
  | ↓ or `-` (if `-` isn't the separator) | previous day |
  | ↑ or `+` / `=` | next day |
  | `t`/`T` or `.` (if `.` isn't the separator) | today |
  | `m` | first day of the month |
  | `M` or `h`/`H` | last day of the month |
  | `y` | first day of the year |
  | `Y` or `r`/`R` | last day of the year |

  With an empty field these start from today. After every change except "today", the calendar drop-down opens. ←/→/Home/End stay inside the field.
- Validation errors appear in an "Invalid date" callout below the field (above it in the Schedule dialog's scheduler mode). The field reverts and keeps focus:
  - unparseable: "Could not understand: '**{input}**'
    - Dates must be in the format: **{format}**" ({input} truncated to 12 characters);
  - more than 3650 days from today: "Selected date is outside range: '**{input}**'
    - Dates must be within 10 years of today";
  - scheduler mode only (the Schedule dialog's Once date, `12` §3.1), before today: "Selected date is outside range: '**{input}**'
    - Transactions can't be scheduled before today".
- New transactions default to the **last date saved** for a new transaction (kept for the session), else today.

## 4. Auto-complete fields (`<AutoComplete>`)

Common behavior: type to filter (case-insensitive). ↑/↓ move. Enter/Tab accept. Esc closes. The rest of the best match is typed ahead and selected. The matched text is bold. Minimum drop-down widths: payee 15.5 rem, category 16 rem, split-line payee 21.5 rem. Non-selectable group headings are supported, as are a header and footer slot.

### 4.1 Payee

Filtering: the name **contains** the typed text. Text starting "Tr…" / "Transfer:" lists transfer entries whose account name contains the part after the colon.
Drop-down (header **"Memorized Payees"**, footer button **"Edit Payees"** → Payee Settings pre-selecting the typed payee):

1. **Enabled**, non-transfer payees, alphabetical.
2. Heading **"Transfer to/from account:"**, then `Transfer: {Account}` for every open account except the transaction's own.
3. Empty-list placeholder: "Your memorized payee list is empty. As you enter payees, Actuality will remember them and list them here."

When opened from the register toolbar's **Transfer** button, the list contains only the transfer entries in item 2, not ordinary payees.

On commit of the payee text:

- A **transfer** (`Transfer:` prefix, whitespace-insensitive, case-insensitive):
  - the transaction is a split → "This transaction cannot be made into a transfer" / "This transaction is already a split transaction, so it can't be turned into a transfer. If you'd like to split a transfer, don't make the main transaction a transfer. Instead, split it and make each of its sub-transactions transfers.";
  - this row is the transfer side created by someone's split line → "This payee cannot be changed" / "This transaction is a transfer from a split transaction, so this payee cannot be changed. You can modify this transaction from the side of the split transaction.";
  - unknown account → "Invalid Payee" / ""{name}" is not a valid account name. If a payee starts with "Transfer:", it must be followed by a valid account name.";
  - same account → "You can't transfer from an account to itself." / "You will need to change either the source account or the target account for this transfer before continuing.";
  - on-budget → on-budget: the category prompt becomes **"(Category not needed)"**, the category is cleared, and focus skips Category.
- A bare `Transfer:` with no account name, left by blur (for example clicking Cancel), counts as no payee: the field is cleared with no error.
- The text is normalized to an existing payee's stored capitalization ("kroger" → "Kroger").
- **Auto-fill** (§4.3) runs.
- A commit caused by Enter/comma while the list is open only accepts the item. Focus moves on only for Tab/Enter commits, not on blur.
- New payee names are created by the host at commit (`payee_name` on create, or `createPayee` on update).

### 4.2 Category

Drop-down (header **"Budget Categories"**, footer button **"Add Category"** → Add New Category dialog):

1. **Split (Multiple Categories)...** (split icon; main row only).
2. Heading `Income:` → the budget's income categories, labelled "Income: {name}" (X1).
3. Each visible expense group as the heading "{Group}:", then its visible categories. Hidden categories and hidden groups are excluded.

Filtering is **prefix**-based (case-insensitive). A category matches if its name (or "Income: name") starts with the typed text. "Ma: Su" matches group prefix + category prefix. A heading stays visible when its name matches or any child matches.

Resolving the typed text on commit:

- empty → no category;
- "Split (Multiple Categories)..." → split mode (§7). It's refused if the transaction is a transfer: "This transaction cannot be split" / "This transaction is already a transfer, so it cannot be split. If you'd like to split a transfer, don't make the main transaction a transfer. Instead, split it and make each of its sub-transactions transfers.";
- contains `:` → resolve "Group: Category" (Income: → the income group);
- otherwise → find a category by name in any group (first match in display order);
- not found → **Add New Category** dialog pre-filled with the parsed group and category names (reserved group names blanked). An "Income" group name instead shows "Please choose a different category name" / "New income categories must be created in the Income group. Choose an existing income category or use a different category group name.";
- the display text after commit is "Group: Category".

**Add New Category dialog** (modal, heading "New Category"): "1. Choose a category group for this category" (an editable combo of existing groups: "Choose an existing category group or enter a name to create one.", placeholder "Category group name"); "2. Type in a descriptive name of this new category" (placeholder "New Category Name"); Cancel / **Create Category**. Errors ("Please choose a different category name"): "You need to enter a master category name and category name first", "You already have a category with this name", plus the `09` §6.1–6.2 name rules. On success the category (and group, if new) is created, assigned and focus moves on. On cancel the field text is restored and keeps focus.

Category prompt for uncategorized on-budget, non-split, non-zero transactions: **"This needs a category"** (orange pill).

### 4.3 Payee auto-fill (X13)

When the payee is committed in the editor and either

- the transaction is "new-like" (no category, empty notes, zero amount, no splits), or
- the payee text differs from the imported payee and there's no category,

then, for an **enabled**, non-transfer payee, `transactions.lastForPayee(payeeId)` gives the most recent non-split transaction with that payee (any account), plus the payee's auto-category rule (`14` §1):

- **Category** (preference `autofillCategory`, default on): filled if empty, on-budget only, and not for transfers to on-budget accounts. Value = the rule's category if a rule exists, else the last transaction's category.
- **Notes** (`autofillNotes`, default off): filled if empty, new-like only. Value = the last notes.
- **Amount** (`autofillAmount`, default off): filled if both outflow and inflow are 0, new-like only. Value = the last amount.

## 5. Notes and tags

Notes are free text and may contain any number of Actual tags anywhere in the text (`04` §5.1). The editor preserves tag spelling and placement, including tags it does not manage. When the user types `#`, offer case-sensitive suggestions from managed tags; choosing one inserts `#name`. Tags may contain any non-whitespace character except `#`; `##` enters a literal hash. A transaction's Notes cell displays tags as colored `#name` pills inline with the note text (`10` §2, §6.2). The special `#needs-review` marker is displayed as a colored pill from review state but is not editable as ordinary note text.

## 6. Commit pipeline (`transactions.commit`)

The renderer runs the interactive steps (dialogs). The host runs validation and the write as **one queue job**. Order:

1. **Can edit?** The renderer checks `useCanEdit()` (`03` §5.3). If offline → the "You're offline" dialog, and the editor stays open. This is only a pre-check. The real gate runs in the host at the start of the write job (step 6, `03` §5.1), and a rejection there shows the same dialog and keeps the editor open too.
2. **Reconciled warnings** (TaskDialog, warning icon, title "Reconciled Transaction", buttons "Yes, make this change" / "No, cancel this change" (default). **No cancels the whole edit**):
   - the transaction is reconciled and date/amount/account changed: "This transaction has already been reconciled. Modifying its account or amount will bring the reconciliation out of balance.\nDo you still want to save this change?" (date only: "Modifying its date may bring the reconciliation out of balance.\nDo you still want to save this change?"). Footer "Changing a Reconciled Transaction". On yes: if the account changed, or the date is after the account's last reconciled date (`04` §2, Actual's `last_reconciled`), it becomes Cleared (and a reconciled other side dated after its account's last reconciliation also becomes Cleared);
   - else the *other side* of a transfer is reconciled and date/amount/account changed: "The other side of this transfer has already been reconciled. Modifying the amount will bring the reconciliation out of balance.\nDo you still want to save this change?" ("Modifying the date may bring…" when the amount is unchanged). Footer "Changing a Transfer to a Reconciled Transaction". On yes the other side becomes Cleared if this transaction's date is after the other account's last reconciliation date;
   - else the other side is reconciled and the payee changed: "The other side of this transfer has already been reconciled. Changing the payee will bring the reconciliation out of balance.\nDo you still want to save this change?" (same footer). On yes the other side becomes Cleared.
3. **Splits** (§7.3). This may show the unassigned-amount dialog. **It runs before step 2**: "Adjust original transaction" and a collapse can change the amount, so the reconciled warnings check the amount the write sends. A Cleared state chosen in step 2 only goes into the write: if a later step keeps the editor open (Cancel in the rename prompt, a write error), the editor still holds the original state, and the next commit asks again.
4. **Payee rename prompt** (§8). Cancel there aborts the commit (the editor stays open).
5. **Unapproved → approved:** if the original needs review and any of date/payee/category/notes/outflow/inflow changed, approve it (remove the tag). The **Approve** buttons approve explicitly.
6. **Write** (host, one queue job): the gate check (`03` §5.1) runs first, then build the Actual payload:
   - `notes = encode(notes, checkNumber, needsReview)` (`04` §5.1);
   - `cleared`/`reconciled` from the state;
   - payee: the existing payee id, a newly created payee id, or the transfer payee id. The new payee is created before `addTransactions` so the read-back can restore it if an Actual rule changes it;
   - category (null for splits and on↔on transfers);
   - subtransactions.

   New → `addTransactions(accountId, [t], { runTransfers: true })`, with `cleared` always set explicitly (`04` §3). Existing → `updateTransaction(id, fields)` through the settling wrapper (`03` §3). For splits, the payload is the parent with the full `subtransactions` array, with existing child ids kept. A changed account → update `account`. This works for normal transactions, transfer sides and split parents: children follow, a move off-budget clears the category, and the other side of a transfer is re-pointed by Actual.

   **Actual's rules on create:** `addTransactions` runs every Actual rule on the new transaction (its handler calls `runRules`, 26.10.0), so an auto-category rule could replace the category the user just chose. The same job reads the row back and writes the user's payee, category and notes again where a rule changed them (user-made rules too, `23` §5). A schedule link a rule made is kept (see Schedule links below). The app's undo re-creation (`10` §8) uses the same step.

   **Collapsing a split:** the public `updateTransaction` with an empty `subtransactions` array leaves a parent with no lines (`is_parent` stays true, 26.10.0). The host writes the collapse as one `transactions-batch-update` (`03` §3): the lines deleted and the parent updated with `is_parent: false`. Without that handler it deletes the lines one by one (deleting the last one turns the parent back into a normal transaction), then writes the parent's fields.

   **Removed split transfer lines:** when the full `subtransactions` array drops a line that was a transfer, or the split collapses into a normal transaction (§7.3), Actual unlinks that line's mirror instead of deleting it (`04` §3). The same job deletes the mirror.

   **Transfer date:** Actual doesn't propagate `date`. If this is a transfer side (or a split with transfer children) and the date changed, the same job then writes the new date to each other side. That write propagates nothing back, because Actual's transfer update doesn't copy dates.
   **Schedule links:** if Actual's rules linked the new or edited transaction to a schedule, the same job restores the user's notes, category and splits (`12` §2) and keeps the link.
7. The write job's `data:changed` invalidates the queries, and the editor closes. The post-write sync then runs as its own job (`03` §5.2), so the commit doesn't wait for the network. "Save and add another" immediately opens a fresh new-transaction editor focused on Date.
8. **Income entered as outflow:** if the category is an income category and the amount is an outflow, then after a successful commit (50 ms delay) a callout "Just Checking..." appears on the outflow cell: "This transaction is categorized as **Income**, but you've entered an **Outflow** instead of an **Inflow**." with buttons **Yes, that should be an inflow** (flips the sign and commits again) / **No, leave it as an outflow**.

New transactions are inserted in sort position. The grid scrolls to the new row and briefly highlights it (a 1 s glow).

Transfers: Actual creates and maintains the mirror. Amount, notes/tags/check number/review (the shared notes, `04` §5.1) and payee propagate. The date is copied by the host, as above. Changing a transfer's target account happens **without confirmation**: Actual moves the existing mirror row to the new account. Changing it to a normal payee also happens without confirmation, and Actual deletes the mirror.

## 7. Split transactions

### 7.1 Entering split mode

Choose **Split (Multiple Categories)...**. A **split editor** grows below the main row:

```text
│ 01/05/26 │ Costco            │ Split (Multiple Categories)... │        │ 150.00 │       │
│          │ [payee/transfer]  │ [category]                     │ [notes]│ [out]  │ [in]  │ [🗑]
│          │ [payee/transfer]  │ [category]                     │ [notes]│ [out]  │ [in]  │ [🗑]
│          │ [+ Add a new sub-transaction]   Amount remaining to assign:  │ 150.00 │  0.00 │
│                                   [Done] [Cancel]                                         │
```

- Two empty lines are created initially (when the split has none). Each line has: a payee field (only transfers are meaningful there: `Transfer: X` makes that line a transfer), a category auto-complete (no Split item; "Add New Category..." opens the dialog), notes, outflow, inflow, and a delete (trash) button.
- "Add a new sub-transaction" appends a line. Entering an amount in the **last** line also appends a new empty line (unless its calculator is open). "Amount remaining to assign:" shows `parent.amount − Σ lines`, live, under the outflow (if negative) or inflow column.
- Lines have their own error icon (e.g. an on-budget transfer with a category → the Remove Category popover).

### 7.2 Display mode

The parent shows "Split (Multiple Categories)..." with a disclosure arrow. The arrow expands the lines (indented, background `--budget-row-alt-even`/white, 600 `body` `--split-text`). Splits are collapsed by default. Search auto-expands them (`10` §4).

### 7.3 Commit rules

- Empty lines (no transfer, category, amounts or notes) are discarded.
- 0 lines left → the transaction becomes uncategorized (not a split).
- Exactly 1 line → collapse into a normal transaction (copy category, transfer payee, notes and amount, each only into an empty parent field), provided there's no conflict (parent payee vs line transfer, parent notes vs line notes, parent amount vs line amount; each only when both are non-empty). Otherwise keep the split.
- If `Σ lines ≠ parent.amount`: TaskDialog "How would you like to handle the unassigned **{remaining}**?" / "The total transaction amount is **{total}**, but the sum of the splits is **{sum}**. This leaves **{remaining}** unaccounted for." with command links:
  - **Manually adjust splits** — "Continue editing the transaction"
  - **Auto-distribute amongst splits** — "Allocate the {remaining} proportionally to the sub-transactions already entered (Sales Tax)." The distribution is proportional to amount and done in integer minor units with `allocate()` (`04` §1): shares are truncated toward zero, and the rounding remainder goes to the line with the largest absolute amount. If all lines are zero, the shares are equal (the remainder goes to the first line).
  - **Adjust original transaction** — "Set the total transaction amount to {sum}"
  - Cancel (like Manually adjust: the commit is refused and editing continues).
- Bulk "Categorize As" skips splits (`10` §6.1).

## 8. Payee rename prompt (on commit)

Trigger: the payee of an **existing** transaction changes from an enabled, non-transfer payee **P** to a non-empty **Q** (case-insensitive compare; when the payee is unchanged but the transaction is being approved, P = its imported payee). Other transactions must also use **P** (if Q is a transfer, transactions in Q's own account and split transactions aren't counted).

TaskDialog "Apply changes to matching transactions?". Content:

```text
"{n} other transactions were found with this payee:<br/>&nbsp;&nbsp;"**P**"<br/>How would you like to handle them?"
```

Command links (the first is the default):

- no category on the edited transaction (or it's a split): **Rename them** — "Rename {n} matching transactions to: "Q""
- category set and some of the others uncategorized (not split, no category, in an on-budget account: off-budget transactions never have a category, so they're neither counted in {k} nor categorized): **Rename and categorize** — "Rename {n} matching transactions to: "Q". Categorize {k} uncategorized transactions as "{category}"." and **Just rename them** — "Rename {n} matching transactions to: "Q". Don't categorize the uncategorized transactions."
- otherwise: **Rename them** — "Rename {n} matching transactions to: "Q"."
- **Leave them alone** — "I just want to change this transaction. Don't change the others."

Footer checkbox **"Don't try to bulk-rename this payee again"** (disables P: `payees.setEnabled([P], false)`), and Cancel (cancels the commit).

Renaming → `payees.rename(P, Q)` (`14` §3): it renames or merges the payee and adds an import rename rule `imported_payee is "P"` → Q. "Rename and categorize" also sets Q's auto-category rule. If no other transaction uses P, the payee entity is simply renamed, without a prompt.

## 9. Keyboard summary (while editing)

| Key | Action |
| --- | --- |
| Tab / Shift+Tab | next/previous field, including Cleared (wraps; income skips outflow) |
| Space / Enter on the Cleared toggle | toggle cleared (§2) |
| Enter | accept the auto-complete selection, otherwise press the default button |
| Shift+Enter | move up, as in Actual (`06` §6): accept the auto-complete selection (an open list closes and focus stays); otherwise, in a split line, go to the same field in the line above (from the first line, the main row). In the main row of an existing transaction: save it as **Done** does (the leave-edit rule, §1, so a needs-review transaction isn't approved), then edit the transaction above it in the register, in the same field. With no transaction above, or in a new transaction, it just saves and closes (**Save**) |
| Ctrl+Enter | from any field, even an open auto-complete list: save and close (**Save** for a new transaction, otherwise **Done**). The pending field commits first, as when a button is pressed |
| Ctrl+Shift+Enter | in a new transaction editor: save the new transaction as **Save** does, then open **Make recurring…** on it (`10` §6.1, `12` §4). Cancelling that dialog keeps the saved transaction. Nothing happens in an existing transaction's editor |
| Ctrl+Shift+C | toggle cleared (§2) |
| Esc | revert the focused field; press again → cancel the edit |
| `+ - * /` in Outflow/Inflow | calculator |
| Date keys | §3 |
| Check # keys | §2 |

## 10. Acceptance criteria

1. Notes round-trip: editing notes containing `#Vacation2025 #trip ⟦chk 101⟧` preserves both case-sensitive tags and the check number. A former `#flag-red` value remains an ordinary tag with no special behavior.
2. A split with a transfer line creates the mirror transaction in the target account (verified via ActualQL).
3. Every dialog in §6–§8 is covered by component tests with mocked RPC.
4. Committing while offline shows the offline error and keeps the editor open with the user's input intact.
