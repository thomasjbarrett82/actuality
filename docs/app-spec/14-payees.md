# 14 — Payees (Memorized Payees, Rename Rules, Payee Settings)

## 1. Payee model & Actual mapping

| Field | Source |
| --- | --- |
| `name` | Actual payee name. Lookup is case-insensitive. If a transaction is saved with an existing payee name in different capitalization, the text is normalized to the stored name ("kroger" → "Kroger", `11` §4.1), and the payee is **not** renamed. Capitalization is changed only by an explicit rename (§3, §4). |
| `enabled` ("List and Autocomplete this payee") | `ad:payees.disabled` (X12). Disabled payees don't appear in the drop-down, don't auto-fill, aren't linked from bank text on import (§2), and don't trigger the bulk-rename prompt. New payees whose name is in the reserved bank-generic list are created **disabled**: "ACH Credit", "ACH Debit", "ACH Deposit", "Automatic Deposit", "Automatic Withdrawal", "Bank Card Purchase", "Cash", "Cashed Check", "Check", "Checkcard Purchase", "Credit", "Credit Notes", "Customer Withdrawal", "Debit Notes", "Deposit", "Deposit - Thank you", "Forced Check", "Home Banking Xfer", "Inclearings Check", "Miline Transfer-in", "Miline Transfer-out", "Purchase", "Point of Sale", "POS Refund", "On-US Check Withdrawal", "Starting Balance", "Teller Cashed Check", "Transfer Credit", "Transfer Debit", "Withdrawal". |
| `transferAccountId` | Actual `transfer_acct`. Transfer payees are created and maintained by Actual, one per account. They display as "Transfer: {Account}" and can't be renamed, combined or disabled by the user. `enabled` = the account isn't closed. |
| auto-fill category | Actual rule: stage `default`, conditions `[{field:'payee', op:'is', value: payeeId}]`, action `[{op:'set', field:'category', value: catId}]`. One such rule per payee is managed by the app. When the payee has several such rules, the app shows the first and leaves the others alone. If there's no rule, auto-fill falls back to the last transaction's category (`11` §4.3). |
| auto-fill notes / amount | derived from the last transaction (X13). |
| rename conditions | Actual rule: stage `pre`, `conditionsOp: 'or'`, conditions on `imported_payee`, action `set payee = payeeId` (X14). Op mapping: Contains → `contains`; Is → `is`; Starts with → `matches` `^{escaped}`; Ends with → `matches` `{escaped}$`. All four are **case-insensitive**. Actual lowercases both the field and the value, **including the regex pattern itself**. `{escaped}` escapes only the regex specials (``.*+?^${}()\|[]\``, `s.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')`) and MUST NOT emit class escapes such as `\S`, `\D` or `\W`, which lowercasing would change. `(?i)` is never written: Actual accepts it but it never matches. Values are stored as typed. Reading a rule back: a `matches` value of the form `^{escaped literal}` or `{escaped literal}$` maps to Starts with / Ends with; any other `matches` value, op or field makes the rule an "Other rule (edit in Rules)", a link that opens it in the rule editor (`23` §2.1). |
| usage count | AQL count of transactions + schedules with that payee. |

Lifecycle:

- Saving a transaction with a new, non-transfer payee name creates the payee. Blank new transactions are ignored.
- Unused payees aren't deleted automatically. Actual cleans up orphaned payees itself if it wants to.
- Built-in payee name: "Starting Balance" (Actual's own). The reconciliation adjustment has no payee (`13` §6.3).

## 2. Import-time behavior

Bank imports go through `importTransactions`, which **runs all Actual rules** (including the rename and auto-category rules above) in stage order: `pre` (rename) first, then `default` (auto-category on the renamed payee). The import never creates ("learns") rules. These facts come from:

- **No title-casing.** The host imports with `payeeNameNormalization: 'original'` (`16` §1.5). The default, `'title-case'`, trims and title-cases both `payee_name` and `imported_payee` (`AMZN Mktp US*123` → `Amzn Mktp Us*123`). With `'original'`, the bank text and any new payee names are kept exactly as sent.
- **Renamed rows** get the rule's payee. No payee is created from their bank text.
- **Unrenamed rows** whose `payee_name` equals an existing payee's name in any case are linked to that payee. Otherwise Actual creates a new payee from the text.
- **Disabled payees:** Actual has no such concept, so rules fire for them too. Before import, the host compares each row's bank text with the disabled payees' names (case-insensitive, trimmed). On a match, it **omits `payee_name`** and sends the text only as `imported_payee`. Rename rules still fire on `imported_payee`; an explicit user rule wins. When none matches, the row's payee stays **empty**. No payee is linked or created, and no auto-category applies. The row is flagged `#needs-review` like every import. One edge case is accepted: a rename rule that targets a disabled payee still links it and applies its auto-category rule.
- The original bank text is preserved in `imported_payee`. The register tooltip shows "Current Payee: …\nImported Payee: …" when they differ.

## 3. Renaming payees (`payees.rename(oldId, newName)`)

- No-op if identical (case-sensitive). A capitalization-only change → `updatePayee(id, {name})`.
- If `newName` matches no payee → `updatePayee(oldId, {name: newName})` (all transactions follow).
- If it matches an existing payee Q → `mergePayees(Q, [oldId])` (keeps Q's name; Actual moves the transactions).
- If `newName` is a transfer ("Transfer: X") → payees can't be merged into transfer payees, so the host updates each eligible transaction's payee to X's transfer payee. That excludes transactions in X itself and split parents, so some may remain. Then it deletes the old payee only if none remain.
- Afterwards add (or extend) the resulting payee's rename rule with the condition `imported_payee is "{old name}"` (unless already present), and remove `is "{old name}"` conditions from other payees' rename rules, so future imports get renamed.
- Transfer payees can't be renamed.

### 3.1 Rename Payee dialog ("Rename like payees..." in the register menu; `--dialog-w`)

```text
 Rename Payee
 All existing "{name}" transactions will have their payee renamed to match the new name.
 (You can use this to change the capitalization of payee as well)
 Current payee name:  Krogers #123
 New payee name:      [ Krogers #123      ]   (payee auto-complete, pre-filled; match any part, 15 rows)
                                       [Cancel] [Rename]
```

Validation: unchanged → "Enter a new payee name" / "To rename a payee, first enter a different payee for the "New payee name"" (**Ok**); blank → "Invalid Payee" / "The new payee may not be blank."; invalid transfer name → "Invalid Payee" / ""{name}" is not a valid account name. If a payee starts with "Transfer:", it must be followed by a valid account name." (Close).

Confirmation (`payees.renameImpact`; names truncated to 30 characters). It's skipped when there are no matching transactions, or exactly one and it can be renamed:

- info dialog "Existing transactions will be renamed", buttons **Rename** / Cancel, content `All ({n}) "**old**" transaction(s) will be renamed to:<br/> "**new**"` or `({k}) of the ({n}) "**old**" transaction(s) will be renamed to:<br/> "**new**"<br/>(The rest can't be renamed because they would be invalid transfers)`, plus `<br/>Note: All renamed transactions will become transfers to the "{account}" account` when new is a transfer;
- none renameable: warning "No transactions could be renamed" / `None of the ({n}) "**old**" transaction(s) can be renamed to:<br/> "**new**"<br/>(They would all cause invalid transfers to be created)` (**Ok**).

### 3.2 Bulk-rename prompt when editing a transaction's payee

See `11` §8.

## 4. Payee Settings dialog

Opened from:

- View ▸ Go to Payee Settings (Ctrl+Y; pre-selects the payee of the selected register transaction);
- the payee drop-down footer **Edit Payees** (pre-selects the typed payee);
- the register menu **Payee settings...** (pre-selects that payee).

With no payee given, it re-selects the last-shown payee. Modal, `--dialog-w-xl`, about 39 rem tall. The payee list (all payees incl. transfers, alphabetical, multi-select with a checkbox per row) is 18 rem wide, with a filter box above it ("Filter payees"). Offline: everything is read-only except selection.

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ Payee Settings                                                              ✕ │
├──────────────────────┬────────────────────────────────────────────────────────┤
│ [Filter payees    ]  │  Kroger                                    [Rename]   │
│ ☐ Amazon             │  [x] List and Autocomplete this payee (used in 12 transactions) (i)
│ ☑ Kroger             │  ───────────────────────────────────────────────────── │
│ ☐ Shell              │  Automatically categorize this payee as: [ Everyday Expenses: Groceries ▾ ]
│ ☐ Transfer : Savings │  ───────────────────────────────────────────────────── │
│ ...                  │  Rename imported transactions to **Kroger** if payee:   │
│                      │   [Contains ▾] [ KROGER #      ] (−)                     │
│                      │   [Starts with▾] [ KRG          ] (−) (+)                │
│                      │                                   [Rename Existing Payees]│
├──────────────────────┴────────────────────────────────────────────────────────┤
│ Autocomplete (all payees): [x] Category [ ] Notes [ ] Amount              [Close]│
└───────────────────────────────────────────────────────────────────────────────┘
```

| Selection | Right panel |
| --- | --- |
| None | "Select a payee to edit" |
| One payee | **Name** (`xl`, `--text-strong`). Clicking it or **Rename** starts an inline edit: a text box, **Save** and a "Cancel" link. Saving (Save or Enter) with a different non-blank name calls `payees.rename` **directly**, without §3.1 validation or confirmation. A "Transfer: …" name shows an invalid-transfer-name warning instead. Blank or unchanged reverts. **List and Autocomplete this payee** checkbox with "(used in **N transaction(s)**)": when N > 0 the count is a link (tooltip "Click to see these transactions in the register") that closes the dialog and opens All Accounts filtered by `Payee: {name},` (and expands the scheduler pane if the payee has schedules); when N = 0 it reads "(used in 0 transactions)". Info tooltip: "When listing and autofill are enabled, payees will show up in the list of payees and will autocomplete and be categorized automatically." **Automatically categorize this payee as:** a category auto-complete (all categories; "Add New Category..." or an unknown "Group: Category" opens the Add New Category dialog; empty clears) → `payees.setAutoCategory` on Enter or blur. "Rename imported transactions to **{name}** if payee:" then the **rename rules** list: each row has an operator combo (10.5 rem: Contains / Is / Starts with / Ends with), a text box and a remove (−) button; the last row also has an add (+) button, enabled only when that row's text is non-blank. **Add a New Rename Rule** is shown only when there are no rules (adds `Contains ""` and focuses it). **Rename Existing Payees** is shown when there's ≥ 1 rule and enabled when the last rule's text is non-blank. It applies the rules now (`payees.applyRenameRules` dry run → confirmation "1 transaction will have its payee renamed to '{name}':" / "{count} transactions will have their payees renamed to '{name}':" ({count} = the number of matching transactions; the content lists the distinct payees they come from), content "**Affected Payees:** 'A', 'B', …", footer "Rename these transactions?", buttons **Rename Transactions** / Cancel). With no matches: info "No transactions found to rename" / "These rules did not match the payees of any transactions" (**Ok**). The rules match against both the payee name and `imported_payee`, using Actual's semantics: lowercased, with `matches` as a lowercased JS regex. Rules left with blank text are discarded when the selection changes. Rule edits save on blur (debounced 500 ms) via `payees.setRenameRules`. Below a separator, the link "**{n} associated rule(s)**" opens the Rules dialog filtered to the payee when rules are associated with it, otherwise **Create a New Rule** opens the rule editor with "payee is {payee}" (`23` §2.1). |
| Several payees | "Multiple Payees Selected ({n})" (bold `xl`, `--accent-blue`) + the names ('A', 'B', …; up to 6 lines). **Combine and Rename Selected Payees?** (info tooltip: "Using this option will combine any payees you have selected into one new payee using the name you enter into the "New Payee Name" field. Additionally, rename rules will be created for this new payee so that future transactions will automatically be renamed.") — "New Payee Name:" (pre-filled with the first name) + **Combine Now** (enabled when non-empty; `payees.combine`, transfer payees skipped, then selects the result). **List and Autocomplete Selected Payees?** (same info tooltip) — **Disable for Selected Payees** / **Enable for Selected Payees** (transfer payees skipped). |
| Transfer payee | **Rename** hidden, list checkbox disabled (follows the account's closed state). Rename rules and auto-category stay editable. |

Footer: "Autocomplete (all payees):" with three app preferences `autofillCategory` (default **on**), `autofillNotes` (off) and `autofillAmount` (off). Tooltips:

- Category — "Actuality will auto-categorize new transactions using the value in the category field if this setting is enabled."
- Notes — "Actuality will auto-fill the notes field with the value that was last used for this payee if this setting is enabled."
- Amount — "Actuality will auto-fill the inflow or outflow field with the value that was last used for this payee if this setting is enabled."

**Close** closes the dialog. Changes apply live, and checkboxes save on change.

## 5. Acceptance criteria

1. A rename rule "Starts with KRG" created here appears in Actual as a `pre` rule, and an imported "KRG 1234" transaction gets the payee.
2. Combining 3 payees leaves 1 payee and moves every transaction.
3. A disabled payee doesn't appear in the editor drop-down, and the flag survives a restart (stored in `ad:payees`).
4. Importing bank text "CHECK" while the payee "Check" is disabled and has an auto-category rule leaves the row with an empty payee and no category, and keeps `imported_payee = "CHECK"`.
5. Imported bank text keeps its original capitalization ("AMZN Mktp US*123"), and a rename rule "Contains amzn" still matches it.
