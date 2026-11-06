# 13 — Account Management & Reconciliation

## 1. Account model (X20)

- Actual has no account type, and the app doesn't store one. An account is its name, its on-/off-budget flag, its closed flag, its order, its native note and Actual's last-reconciled time (`04` §2). Every account is treated alike: there are no asset or liability accounts, no type-specific defaults and no sign checks on balances. A negative balance (a credit card, a loan) is entered as a negative number.
- Account rules: name non-empty, unique (case-insensitive), no `` ` ``.

## 2. Create Account dialog (modal, `--dialog-w`)

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│  Create a New Account                                                 ✕ │
├────────────────────────────────────────────────────────────────────────────────┤
│  Name:                                   [ New Account                 ] │
│  [ ] Off budget                                                          │
│  Balance:                                [ 0.00                        ] │
│                                                                          │
│                                                [Cancel] [Create Account] │
└────────────────────────────────────────────────────────────────────────────────┘
```

Create, edit and delete follow Actual's own behavior: the same fields and the same operations, with no extras.

- Opened from the sidebar **Add Account** (needs `canEdit`).
- Default name (computed once on open): "New Account", or with " 2", " 3"… appended if taken.
- **Off budget** checkbox, unchecked by default. Tooltip: "Off-budget accounts are tracking accounts, like investments, mortgages or assets. Their transactions don't affect your budget." The choice can't be changed afterwards.
- **Balance**: the current balance, which becomes the starting balance. An empty balance counts as 0. Any sign is accepted, with no confirmation: a balance owed is typed as a negative number.
- Validation on Create:
  - name errors (dialog "Please choose a different account name"): "Account name cannot be empty.", "An account with this name already exists.", "An account name may not contain: `";
  - balance not numeric: "Invalid Balance" / "'**{value}**' is not a valid number".
- **Create** (`accounts.create`, one host job): `createAccount({name, offbudget}, balance)` → id, then navigate to the new account's register. Actual creates the starting-balance transaction itself and the app leaves it as Actual made it: dated today, Cleared, payee "Starting Balance", and for an on-budget account the income category "Starting Balances". A zero balance creates no transaction. The app doesn't change the date or category.

### 2.1 Category of slate wipe starting balances

Applies only to the starting balances a slate wipe creates (`18` §2), which have no Actual equivalent. They get the category Actual gives its own starting balances: for an **on-budget** account, whatever the sign of the amount, Actual's "Starting Balances" income category if it exists, else the first income category. A negative amount lowers that month's income. **Off-budget** accounts: no category. (The reconciliation adjustment follows Actual instead and has no category, §6.3.)

## 3. Renaming an account and editing its note

As in Actual, both are edited in place, in the register's **account header** (`10` §1). There is no properties popover and no type, balance or on/off-budget editing here.

- The header shows only when the register shows a single account (not All Accounts): the account name (600 `xl`), a **Notes** icon button and a **Rename** icon button (shown on hover or keyboard focus of the header), and the account **⋯ menu** (§4). Offline, the buttons and the menu are disabled with the tooltip "Editing is unavailable while offline".
- Right-clicking an account in the sidebar (`08` §2.2), or Edit ▸ Rename Account / Edit Account Note / Close Account / Re-open Account (`06` §4 Edit), reaches the same actions on that account. **Rename Account** and **Edit Account Note** first open that account's register (when it isn't the one shown) and then act in its header. **Close Account** and **Re-open Account** act where they are, without navigating.
- **Rename**: the name becomes a text input with its text selected. **Enter** or a click away saves, **Esc** cancels. The name is validated only if it changed other than in letter case. Errors: empty → "Provide an account name" / "Account name cannot be empty."; duplicate → "Choose a different account name" / "You already have an account named '{name}'"; backtick → "Choose a different account name" / "An account name may not contain: `` ` ``". On an error the input stays open.
- **Notes**: opens the note popover (`09` §6.3) titled with the account name. It is saved as the native account note (note id `account-{id}`, `04` §3), so Actual shows it too.

## 4. Closing and re-opening an account

The **⋯ menu** of an open account has **Close Account**. A closed account's menu has **Re-open Account** (`reopenAccount`). Closed accounts appear in the sidebar's Closed Accounts group and stay viewable.

**Close Account** always opens a dialog (`--dialog-w`, buttons Cancel / **Close Account**), also when the balance is 0. It behaves as Actual's does:

- No transactions: text "Close '{name}'? This account has no transactions, so it will be permanently deleted." → `closeAccount(id)`, which deletes such an account (`04` §3). The app then does the same clean-up as a delete (§5).
- Transactions and balance 0: text "Close '{name}'? This account has transactions, so it can't be permanently deleted. You can re-open it later from Closed Accounts." → `closeAccount(id)`.
- Balance ≠ 0: text "Close '{name}'? To close it, choose an account to transfer the remaining {balance} into." with an account combo "Transfer to:" (open accounts only) and, when moving money from an on-budget to an off-budget account, a category combo "Category:" (Actual requires one) → `closeAccount(id, transferAccountId, transferCategoryId)`.
- Only when the account has transactions: at the bottom, a **Force close** link with the text "Force close deletes this account and all of its transactions. This can't be undone." It opens the deletion confirmation (§5).

## 5. Deleting an account

Actual has no separate delete. An account without transactions is deleted by a plain close (§4); one with transactions is deleted by **force close**, whatever it holds.

- Confirmation (warning icon): "Delete account '{name}'?" / "Deleting an account cannot be undone. All of its transactions will be deleted, and if it is an on-budget account, the money in them will disappear from your budget." — **Delete Account** / Cancel.
- On confirm: `deleteAccount(id)` (`accounts.delete`). The account's native note (`account-{id}`) is cleared, and the import mappings that point to it are removed. Selection moves per `08` §2.3.
- Only an **open** account can be force-closed, so there is no re-open step. A closed account can only be re-opened.

## 6. Reconciliation

**Deliberate exception.** Account management follows Actual, and so does the adjustment transaction (§6.3), but the reconciliation workflow keeps the classic design's **statement date**: Actual's reconcile asks only for a balance and works on every cleared transaction, while this app asks for a date and a balance, and the reconcile view shows only transactions dated on or before that date (§6.1–6.2).

### 6.1 Start — Reconciliation Statement dialog (`--dialog-w-sm`)

Triggered by **Reconcile Account** (not in All Accounts, not offline).

```text
 Reconcile Account
 Enter the balance from your account website or paper statement to begin reconciling. Learn more.
 What date do you want to reconcile against?   [ 01/31/2026 📅 ]
 What is your account balance on that date?    [            ]
     Your cleared balance in Actuality is $1,234.56. Use this amount.
                                   [Cancel] [Begin Reconciliation]
```

- The date defaults to today. When continuing, it's the in-progress date and the button reads **Continue Reconciliation**.
- The hint line shows the cleared balance *through the chosen date* (`reconcile.clearedThrough`) and is recalculated when the date changes. It counts what the footer's "Cleared balance as of {statement date}" counts (§6.2): every reconciled transaction, whatever its date, plus the cleared ones dated on or before. So "Use this amount." always starts with a difference of 0. "Use this amount." fills it in and **immediately begins** reconciliation. The line keeps its place while the amount is recalculated, so the buttons below it don't move under the pointer.
- **Begin Reconciliation**, **Continue Reconciliation** and Enter in either field use the date typed in the field, committed first. An invalid date shows its callout (`11` §3) and the dialog stays open, because beginning with another date would change which transactions are reconciled. "Use this amount." also commits a typed date first; if that changes the date, the hint recalculates and reconciliation doesn't begin, because the amount shown was for the old date.
- Invalid balance → "Invalid Balance" / "'{value}' is not a valid number". "Learn more" opens the help URL.
- The amount is taken as typed, with its sign. A balance owed is typed as a negative number.
- On Begin: store `{statementDate, target}` in the register's session state (not persisted) and switch the register to reconcile mode. **Adjust Statement** reopens the dialog in continue mode.

### 6.2 Reconcile mode (500 ms transition)

- The toolbar hides the date filter, the reconciled filter and Import. The footer hides the Scheduled toggle, the Summary box and Reconcile, and shows the **Reconciliation footer** (sized to its content). The scheduler pane collapses (and is restored afterwards).
- The grid shows only **unreconciled** transactions dated **on or before the statement date**, sorted by date. The Cleared column widens to 7 rem and is always visible. Clicking C toggles cleared as usual. Search still works (the info bar shows "Showing {n} transactions … on or before {date} (statement date)" with **Clear Search**).

Footer:

| Label | Value |
| --- | --- |
| "Last cleared balance from {lastReconciledDate}" / "This account has never been reconciled" | `reconciledBalance` |
| "Transactions cleared above" | Σ Cleared (not reconciled) in the list (boxed) |
| "Cleared balance as of {statement date}" | reconciled + cleared above (rule line above) |
| "Statement balance as of {statement date}" | target (boxed) |
| "Difference between Actuality and your statement" | `(reconciled + clearedAbove) − target` |

{lastReconciledDate} comes from Actual's own `last_reconciled` account field (`04` §3): the time the last reconciliation finished, in this app or in Actual web, shown as its local calendar date. When it's empty, the account has "never been reconciled". Finishing a reconciliation sets it (§6.3), so Actual web shows it too.

Message: "Clear transactions above to make Actuality\nmatch your statement", or when the difference is 0, "Great job!\nYour account is now reconciled". Buttons: **Finish Reconciliation**, **Adjust Statement**, **Stop Reconciling** (leave the mode, keeping cleared marks).

### 6.3 Finish (`reconcile.finish`)

- If the difference ≠ 0: TaskDialog (warning) "Actuality and your bank aren't balanced" / "Would you like Actuality to create an adjustment transaction to bring the account balance in line with your bank statement?" with **Create an adjustment transaction** / **Continue reconciling** (default). Creating it adds the transaction Actual adds: an amount of `−difference`, **no payee and no category**, **Cleared** (it becomes Reconciled with the rest in step 1), and the notes "Reconciliation balance adjustment" (in the UI language when it's created, `20` §3.8). Actual's rules run on it as they do on any added transaction (`23` §5). On an on-budget account it shows as uncategorized until a rule or the user gives it a category, as in Actual. The one difference from Actual: it's dated the **statement date**, not today, so it falls inside the reconcile list (the exception above).
- Then, in one host job:
  1. Set every Cleared transaction in the reconcile list to **Reconciled**, which also approves them. Use `updateTransaction(id, {cleared: true, reconciled: true})` through the settling wrapper (`03` §3). For transactions that carry `#needs-review`, the same call also writes `notes = encode(notes, checkNumber, flag, false)` (`04` §5.1), since approval lives in the notes. On a transfer this approves both sides (`X22`), while the other side keeps its own cleared/reconciled state.
  2. Set the account's `last_reconciled` to the current time in milliseconds, as a string, exactly as Actual web does (`updateAccount(id, { last_reconciled })`, `04` §3).
  3. Sync.
- The register returns to normal (the previous search, date filter and sort are restored).

### 6.4 Editing reconciled transactions

See `11` §6 (warnings), `10` §6.4 (can't toggle C) and `10` §6.1 (move restrictions).

## 7. Ordering and closed accounts

- Order: `sortIndex`, changed by drag-and-drop within a sidebar group (`08` §4).
- An account is on or off budget from creation and stays that way (§2).
- Closed accounts: excluded from the payee transfer list and from new-transaction account choices and "Move to account".

## 8. Acceptance criteria

1. Creating an account with balance −500 creates a −500 starting balance dated today, Cleared, with Actual's own category ("Starting Balances" for an on-budget account, none for an off-budget one), and no other category or group.
2. Full reconcile flow on the fixture: after Finish, all cleared transactions ≤ statement date are reconciled in Actual (AQL `reconciled = true`), and the account's `last_reconciled` holds the finish time, which the next reconciliation shows. A `last_reconciled` written by Actual web is shown the same way. An adjustment has no payee and no category and is Reconciled.
3. Name and note edits survive a restart and are visible from a second client (e2e with two hosts).
4. Closing an account with no transactions deletes it. Close with a balance transfers it to the chosen account. **Force close** is offered only for an account with transactions and deletes it, and a closed account offers only Re-open.
