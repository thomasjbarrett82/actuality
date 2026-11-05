# 23 — Rules

Actual's **rules** change transactions as they arrive: they rename payees, set categories, add notes, split transactions and more. The app lists every rule in the budget and edits them in a dialog, within Actual's own limits on stages, fields, operators and actions. The payee rename and auto-category rules of Payee Settings (`14` §1) and the rules behind schedules (`12` §1) are ordinary Actual rules and appear here too.

In summary: every rule is listed, schedule rules read-only (§2); every stage, condition field, operator and action that Actual's rule engine accepts can be edited, except the experimental templates and formulas, which are kept and shown read-only (§1.3); the editor lists matching transactions and can apply its actions to them (§3.4); the app keeps its note metadata when rules change notes (§5).

## 1. Rule model & Actual mapping

```ts
interface Rule {
  id: Id;
  /** Actual stores the default stage as null; 'default' is read as null. */
  stage: 'pre' | null | 'post';
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];   // kept whole, unknown keys included
  actions: RuleAction[];         // kept whole, unknown keys included
  /** Set for a schedule's rule (it has a `link-schedule` action, 12 §1). */
  schedule: { id: Id; name: string | null } | null;
}
interface RuleCondition { field: string; op: string; value: unknown; type?: string; options?: { inflow?: true; outflow?: true }; [k: string]: unknown }
interface RuleAction { op: string; field?: string; value: unknown; type?: string; options?: { splitIndex?: number; method?: string; template?: string; formula?: string }; [k: string]: unknown }
```

Reads use `getRules()`, writes `createRule` / `updateRule(full rule)` / `deleteRule` (`04` §4). Actual validates every rule it is given, and the editor (§3) applies the same limits first, so a save doesn't fail on input the editor allowed.

### 1.1 Stages and order

Rules run in three stages: **Pre** (`pre`), **Default** (`null`) and **Post** (`post`). Within a stage, Actual ranks rules from least to most specific. Each condition scores by its operator (`is`/`is not` 10, `is one of`/`is not one of` 9, `is approximately`/`is between` 5, the comparisons 1, everything else 0), and a rule whose conditions are all `is`, `is not`, `is approximately`, `is one of` or `is not one of` scores double. Ties go by id. The list (§2) shows rules in this run order, computed with the same scores (`shared/domain/rules.ts`). When two rules set the same field, the later one wins.

### 1.2 Conditions

A rule matches when **all** (`and`) or **any** (`or`) of its conditions match. A rule with no conditions never matches, so the editor requires at least one. String matching is case-insensitive.

| Field (label) | Actual field and options | Operators | Value |
| --- | --- | --- | --- |
| Imported payee | `imported_payee` | is, is not, contains, does not contain, matches, is one of, is not one of | text; a list of texts for the "one of" operators |
| Payee | `payee` | is, is not, is one of, is not one of, contains, does not contain, matches | a payee (empty means "no payee"); a list of payees; text for contains / matches |
| Account | `account` | the payee operators, plus is on budget, is off budget | an account; a list; text; nothing for on/off budget |
| Category | `category` | the payee operators | a category (empty means "uncategorized"); a list; text |
| Category group | `category_group` | the payee operators | a category group; a list; text |
| Date | `date` | is, is approximately, is after, is on or after, is before, is on or before | `is`: a date, a month or a year; `is approximately` (±2 days) and the comparisons: a date |
| Notes | `notes` | is, is not, contains, does not contain, matches, has all tags, has any of tags | text; tags as `#a #b` |
| Amount / Amount (inflow) / Amount (outflow) | `amount`; `options.inflow` / `options.outflow` | is, is approximately (±7.5%), is between, is greater than, is greater than or equal to, is less than, is less than or equal to | an amount (signed for Amount, a magnitude for inflow/outflow); two amounts for is between |
| Cleared / Reconciled | `cleared` / `reconciled` | is | Yes / No |

Limits the editor applies, as Actual does: date, amount and yes/no values are required; contains, does not contain, matches and the tag operators need non-empty text; `matches` must be a valid regular expression (Actual lowercases the pattern, `14` §1); the "one of" operators need at least one item. A condition the editor can't show (another field, such as `payee_name`, `saved`, `transfer` or `parent`, or a date `is` with a recurring pattern, which Actual allows) is listed as read-only text, kept as it is, and can be removed.

### 1.3 Actions

| Action (label) | Actual action | Value |
| --- | --- | --- |
| Set account / category / date / payee / notes / cleared / amount | `{ op: 'set', field }` | an account (required); a category (empty clears it); a date; a payee, transfer payees included; text; Yes / No; an amount with Outflow / Inflow |
| Prepend to notes / Append to notes | `prepend-notes` / `append-notes` | non-empty text, added as typed |
| Delete transaction | `delete-transaction` | none |
| Link to schedule | `link-schedule` | read-only; only schedule rules have it |

A `set` action with `options.template` (a Handlebars template) or `options.formula` is experimental in Actual: the editor lists it read-only ("Set {field} with a template" / "… with a formula", the template text as a tooltip), keeps it as it is, and lets it be removed. So is any other action op Actual adds later.

**Splits.** Actions with `options.splitIndex` ≥ 1 split the transaction: `set-split-amount` gives split *n* its amount, by `options.method`:

- **Fixed amount** (`fixed-amount`): the value, signed (Outflow / Inflow);
- **Percent of the remainder** (`fixed-percent`): 0–100, a share of what the fixed amounts leave;
- **Remainder** (`remainder`): an even share of what is left after the fixed amounts and percentages; the last remainder split takes any rounding.

A `formula` method is kept read-only, like formulas above. Each split has exactly one amount and may also set category, payee or notes, or prepend or append notes. Actions without a split index apply to the whole transaction first. Removing a split renumbers the later ones.

### 1.4 Rules for a payee

A rule is **associated** with a payee when a condition or action on the `payee` field names it (`is`, or in a "one of" list), as Actual's `getPayeeRules` does. Payee Settings counts these (§2.1).

## 2. Rules dialog

Opened from:

- View ▸ **Go to Rules** (Ctrl+U), with no filter;
- Payee Settings' "{n} associated rules" link (§2.1), filtered to that payee.

Modal standard dialog, `--dialog-w-xl`, about 39 rem tall. Offline it is read-only: rows open the editor read-only, and Create and Delete are disabled.

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ Rules                                                                       ✕ │
├───────────────────────────────────────────────────────────────────────────────┤
│ [Filter rules              ]   Payee: Kroger (✕)                              │
│ ☐  Stage     Rule                                                             │
│ ☐  Pre       If imported payee contains "KROGER" then set payee to Kroger     │
│ ☐  Default   If payee is Kroger then set category to Food: Groceries          │
│ ☐  Schedule  If payee is Rent Co and amount is approximately -1,200.00 …      │
├───────────────────────────────────────────────────────────────────────────────┤
│ [Delete 1 rule]                                [Create a New Rule]   [Close]  │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Rows** are in run order (§1.1). The Stage column reads "Pre", "Default", "Post", or "Schedule" for a schedule's rule. The Rule column is the rule's text: "If {conditions} then {actions}", conditions joined by " and " or " or ", actions by ", ", and split actions as "split {n}: …". Names come from the budget's payees, accounts and categories (a missing one reads "(deleted)"), amounts and dates in the budget's formats, through privacy mode (`06` §7). Long text is cut with an ellipsis, with the full text as a tooltip.
- Clicking a row's text, or Enter on it, opens the rule editor (§3). The checkbox (Space) selects the row for deletion. A schedule's rule has no checkbox: it is deleted with its schedule.
- **Filter rules** keeps the rows whose text contains the filter (case-insensitive). The payee chip shows only the rules associated with the payee (§1.4); its ✕ removes the filter.
- **Delete {n} rules** (shown with at least one row checked): TaskDialog "Delete 1 rule?" / "Delete {n} rules?", content "Deleted rules can't be restored.", buttons **Delete** / Cancel, then `rules.delete`.
- **Create a New Rule** opens the editor for a new rule. With the payee filter on, it starts with the condition "payee is {payee}".
- Empty states: "There are no rules yet." / "No rules match the filter."
- **Close** or Esc closes the dialog.

### 2.1 From Payee Settings

Below the rename rules (`14` §4), a row for the single selected payee: when rules are associated with it (§1.4), the link "**{n} associated rule(s)**" opens this dialog filtered to the payee; otherwise the button **Create a New Rule** opens the editor with the condition "payee is {payee}". A rule the payee panel can't show as its rename or auto-category rule is still listed there as "Other rule (edit in Rules)", now a link that opens that rule in the editor.

### 2.2 From the register

The actions menu (`10` §6.1) item **Create a new rule...** (exactly one transaction selected; disabled offline) opens the editor for a new rule, pre-filled from that transaction:

- conditions: "imported payee is {imported payee}" when the transaction has one, otherwise "payee is {payee}" when it has a payee; and "account is {account}";
- actions: "set payee to {payee}" when it has a payee, and "set category to {category}" when it has a category (not for splits or transfers).

The user removes what they don't want.

## 3. Rule editor dialog

Standard dialog, width `xl`. Title "New Rule" or "Edit Rule"; a schedule's rule opens read-only with the title "Schedule Rule". It edits a copy: nothing is written until **Save**, and Cancel or Esc discards it. Offline, the fields are disabled and Save and Apply Actions are disabled.

```text
 New Rule
 Stage: (Pre | Default | Post) (i)
 If [all ▾] of these conditions match:
   [Imported payee ▾] [contains ▾] [ KROGER        ] (−)
   [Account ▾]        [is ▾]       [ Checking ▾    ] (−)
   (+ Add condition)
 Then apply these actions:
   [Set payee ▾]                   [ Kroger ▾      ] (−)
   (+ Add action)   (+ Add a split)
 Split 1   [Fixed amount ▾] (Outflow|Inflow) [ 20.00 ]   (Remove split)
   [Set category ▾]                [ Food: Groceries ▾ ] (−)
 ──────────────────────────────────────────────────────────
 Matching transactions                              [Apply Actions]
 ☐ Date  Account  Payee  Category  Notes  Amount
                                               [Cancel] [Save]
```

### 3.1 Stage and conditions

- **Stage**: a segmented control, Pre / Default (the default) / Post, with an info tooltip "Rules run in stage order: Pre, then Default, then Post. Within a stage, less specific rules run first, so a more specific rule can override them."
- "If [all / any] of these conditions match:" then one row per condition: the field (§1.2 labels, written lowercase as they read in the rule's text: "imported payee", "amount (inflow)"), the operator (only those Actual allows for the field), the value editor, and a remove (−) button. Changing the field keeps the operator if it is still allowed, otherwise picks the first. A different Actual field starts with an empty value (typed text is kept), and switching an amount to Amount (inflow) or (outflow) keeps its magnitude. **Add condition** adds "Imported payee contains" and focuses its value.
- Value editors: text box; payee / account / category / category group auto-completes (a "one of" operator collects several as removable chips); date field (`is` adds a Date / Month / Year choice); money field with Outflow / Inflow for Amount, a plain money field for inflow and outflow; Yes / No.

### 3.2 Actions and splits

- "Then apply these actions:" one row per action: the action (§1.3 labels), its value editor, and remove (−). **Add action** adds "Set category".
- A "Set notes" row shows the caution "Replaces the whole note. Actuality keeps a transaction's check number and review tag when it imports or applies a rule." (§5)
- **Add a split** adds "Split {n}": an amount method (Fixed amount / Percent of remainder / Remainder), its value, the split's own actions (Set category / payee / notes, Prepend / Append to notes) with **Add action**, and **Remove split**.
- Read-only rows (§1.2, §1.3) show their text in italics with only the remove button.

### 3.3 Save

**Save** checks every row (§1.2 limits, at least one condition and one action, each split's amount). If any row is incomplete: warning "This rule isn't complete" / "Fill in or remove the highlighted rows." (Close); the rows get `aria-invalid` and the error outline. Otherwise `rules.save` writes the rule (`createRule` or `updateRule` with the full rule, unknown keys kept) and the dialog closes. Host errors show "Something went wrong" with Actual's message.

A schedule's rule: the footer has **Edit Schedule** (opens the Schedule dialog for that schedule, `12` §3.1, and closes this one) and **Close**.

### 3.4 Matching transactions

The bottom section lists the transactions the dialog's **current, unsaved** conditions match, most recent first, up to 100 ("Showing the first 100 matches." below when there are more): checkbox, Date, Account, Payee, Category, Notes (without the app's tokens), Amount. Split lines are listed on their own, as Actual's rules see them. The list refreshes 300 ms after the conditions change. Any change clears the listed rows and the checked ones at once, and a response for earlier conditions is ignored, so Apply Actions only acts on rows the current conditions match. Messages: "Complete the conditions to see matching transactions." when any condition is incomplete; "No transactions match these conditions."; "Actual can't list matching transactions." when the internal handler is missing (`03` §3); "The matching transactions couldn't be loaded." on an error.

**Apply Actions** (enabled with at least one row checked and every action complete) applies the dialog's current actions, saved or not, to the checked transactions: TaskDialog "Apply this rule's actions to 1 transaction?" / "Apply this rule's actions to {n} transactions?", content "The selected transactions change now. Undo isn't available.", buttons **Apply Actions** / Cancel, then `rules.applyActions`. The header checkbox checks every listed row.

## 4. Host methods (`03` §8)

| Method | Does |
| --- | --- |
| `rules.list()` → `Rule[]` | every rule, in run order (§1.1), with `schedule` filled from `getSchedules()` |
| `rules.save(rule)` → `{ id }` | write job: `createRule` without an id, otherwise `updateRule` with the full rule. Refuses a schedule's rule (`validation`, `code: 'schedule-rule'`). Tables `rules`. |
| `rules.delete(ids)` → `null` | write job: `deleteRule` for each; schedule rules are skipped. Tables `rules`. |
| `rules.matches({ conditionsOp, conditions })` → `{ rows: RuleMatch[], more: boolean } \| null` | read job: Actual's internal `make-filters-from-conditions` turns the conditions into its query (`$and` or `$or`), rows with `splits: 'inline'`, newest first, limit 100. No conditions → no rows. null when the handler is missing. |
| `rules.applyActions({ ids, actions })` → `{ count }` | bulk write job (timed per transaction, `03` §3): reads the rows, runs Actual's internal `rule-apply-actions` with them, then restores the app's note metadata (§5). Tables `transactions`, `payees`, `schedules`. |

`RuleMatch` is `{ id, accountId, date, payeeId, categoryId, notes, amount }`. Every write is gated (`03` §5) and has an integration test proving it is refused offline. Rule writes emit `data:changed {rules}`, which refreshes the `rules` and `payees` queries (`03` §4.1).

## 5. Rules and Actuality's own writes

- **Import** (`16` §1.5): Actual runs every rule on imported rows. A rule that sets or rewrites notes can remove the check-number token and the `#needs-review` tag (`04` §5.1). After the import, the host puts back the imported check number and the review tag on added rows that lost them, keeping the rest of the notes as the rule left them.
- **Apply Actions** (§3.4): the same restore, for each changed row that had a check number or the review tag before.
- **Entering transactions in the register** (`11` §6): unchanged. Actual runs the rules on create, and the commit's read-back puts back the payee, notes, category and splits the user entered, so a rule doesn't override what was typed, empty fields included. Fields the register doesn't restore (account, date, amount, cleared) keep what a rule set. Imported transactions get the full effect of the rules.
- **Reconciliation adjustment** (`13` §6.3): Actual runs the rules on it, as Actual web does, and the host restores nothing, so a rule may give it a payee or a category.
- Rules run only when Actual adds transactions; updates don't re-run them (`12` §2).

## 6. Acceptance criteria

1. View ▸ Go to Rules (Ctrl+U) lists every rule in Actual's run order, including the payee rules from Payee Settings and schedule rules (read-only).
2. A rule created in the editor ("imported payee contains AMZN" → "set payee to Amazon", stage Pre) is in Actual with those conditions and actions, and an imported "AMZN Mktp US" row gets the payee Amazon.
3. Editing a rule that has a template action, or a condition the editor can't show, keeps them unchanged.
4. A rule with two splits (fixed 20.00, remainder) applied to a 50.00 outflow gives a split of 20.00 and 30.00.
5. Apply Actions with "set notes to Groceries" on a transaction with check number 1234 and the review tag leaves notes "Groceries ⟦chk 1234⟧ #needs-review".
6. Offline, `rules.save`, `rules.delete` and `rules.applyActions` are refused, and the dialogs are read-only.
7. Payee Settings shows "{n} associated rules" for a payee with rules (opening the filtered list) and **Create a New Rule** for one without; the register's **Create a new rule...** opens the editor pre-filled from the transaction.
