# 04 — Data Model, Actual Mapping & Metadata Encoding

The app's domain types are defined in `src/shared/domain/`. The host converts Actual objects to these types. The renderer only sees these types.

## 1. Primitives

```ts
type Id = string;                 // Actual UUID
type Money = number;              // integer, minor units (Actual amount). Never a float.
type ISODate = `${number}-${number}-${number}`;   // 'YYYY-MM-DD'
type Month = `${number}-${number}`;               // 'YYYY-MM'
type ClearedState = 'U' | 'C' | 'R';              // Uncleared / Cleared / Reconciled
type ErrorLevel = 'none' | 'needsCategory' | 'forReview' | 'error';   // rank 0 / 1 / 5 / 10
type BudgetType = 'envelope';
```

`src/shared/money.ts`:

- `decimals(currencyCode)`: from `Intl.NumberFormat(…, {style:'currency', currency}).resolvedOptions().maximumFractionDigits`. If `hideFraction` is set, display with 0 decimals but store unchanged. **Storage scale is always ×100, whatever the currency**. `MINOR_UNITS_PER_MAJOR = 100` is a constant, not a per-budget value. All conversions go through `money.ts`.
  - Confirmed for no currency, USD and EUR (€12.34 → `1234`), and for **JPY**: ¥100,000 typed → `10000000` stored, and Actual web's register shows ¥100,000.
  - **Display decimals** follow the currency: `decimals(currencyCode)` gives 0 for JPY/KRW/IRR. The value is still divided by 100, so `10000000` displays as "¥100,000". Typing "¥100,000" parses to `10000000`. Any sub-unit remainder in 0-decimal currencies (e.g. `10000050`) is rounded half away from zero for display only, never on write.
  - **Known Actual bug (26.2.0):** Actual web's *budget page* shows 0-decimal currencies 100× too large (¥10,000,000 for `10000000`). Its shared `integerToCurrency(amount, formatter, decimalPlaces)` divides by `10^decimalPlaces`, and the budget page passes the currency's decimal places (0) instead of 2. The app follows the register/storage convention and does **not** copy this bug. That is the one known exception to "numbers always equal Actual web's" (D2). Report it upstream. If Actual fixes it in a way that changes storage, revisit this rule.
- `format(m, {symbol, thousands, sign})`, `parse(text, locale) → Money | null`. Parsing is lenient: accepts `.` or `,` as decimal when unambiguous, thousands separators, a leading `-`, and parentheses as negative. Rounding is half away from zero to minor units.
- Arithmetic: integers only. Proportional distribution (`11` §7.3, `allocate()` in `money.ts`): compute each share on absolute values, truncate toward zero, apply the sign of the amount being distributed, then add the whole rounding remainder to the line with the largest absolute amount (the first such line on ties).

## 2. Domain entities

```ts
interface Account {
  id: Id; name: string;
  onBudget: boolean;              // Actual: !offbudget
  closed: boolean;                // Actual: closed  ("hidden")
  sortIndex: number;              // Actual sort_order (: writable via updateAccount)
  note: string | null;            // Actual note with id `account-{account.id}` (visible in Actual; )
  lastReconciledDate: ISODate | null;   // Actual last_reconciled (ms timestamp), as a local calendar date
  accountGroupId: Id | null;      // Actual account_group_id — preserved, not shown
  balances: { cleared: Money; uncleared: Money; working: Money; reconciled: Money };
  attention: { count: number; maxLevel: ErrorLevel };
  hasTransactions: boolean; scheduledCount: number;
}

interface Transaction {
  id: Id; accountId: Id; date: ISODate; amount: Money;       // + inflow / − outflow
  payeeId: Id | null; payeeName: string;                   // resolved display name
  transferAccountId: Id | null;                            // from payee.transfer_acct
  transferId: Id | null;                                   // Actual transfer_id (other side)
  categoryId: Id | null;                                   // null on split parents
  notes: string;                                            // notes minus metadata tokens (§5.1), with user tags intact
  tags: string[];                                           // derived, case-sensitive Actual tags present in notes
  checkNumber: string | null;                              // token in notes
  needsReview: boolean;                                    // tag in notes
  cleared: ClearedState;                                   // Actual cleared + reconciled
  importedId: string | null; importedPayee: string | null;
  scheduleId: Id | null;                                   // Actual schedule
  isStartingBalance: boolean;                              // Actual starting_balance_flag
  subtransactions: SubTransaction[];                       // non-empty ⇒ split
  errorLevel: ErrorLevel; errorMessage: ErrorMessage | null; // derived (§7): a message key, see below
  rawNotes: string;                                        // untouched original, for round-trip
  transferSide: TransferSide | null;                       // the other side of a transfer (below)
}

// The other side of a transfer, read with the register (one query by id). The reconciled warnings (11 §6),
// the delete and move rules (10 §6.1, §8) and the locks on a transfer created by a split elsewhere (11 §2,
// §4.1) need it, and that side may be in an account the renderer hasn't loaded.
interface TransferSide { id: Id; accountId: Id; date: ISODate; cleared: ClearedState;
  isSplitLine: boolean }                                   // true: the other side is a split's line

interface SubTransaction {
  id: Id; parentId: Id; amount: Money;
  payeeId: Id | null; transferAccountId: Id | null; transferId: Id | null;
  categoryId: Id | null; notes: string; rawNotes: string;
  errorLevel: ErrorLevel; errorMessage: ErrorMessage | null;
  transferSide: TransferSide | null;
}

// The host never formats user-visible text (20 §3.4), so a derived state carries a key, and the renderer
// shows the §7 text in the UI language. A split parent's message lists its problem children's messages.
interface ErrorMessage { key: 'onBudgetTransferCategorized' | 'splitProblems' | 'reviewScheduled'
  | 'reviewImported' | 'needsCategory' | 'offBudgetTransferNeedsCategory'; children?: ErrorMessage[] }

interface CategoryGroup { id: Id; name: string; isIncome: boolean; hidden: boolean;
  sortIndex: number; note: string | null; categories: Category[] }
interface Category { id: Id; groupId: Id; name: string; isIncome: boolean; hidden: boolean;
  sortIndex: number; note: string | null }

interface Payee { id: Id; name: string; transferAccountId: Id | null;
  enabled: boolean;                        // ad:payees (X12); transfer payee: = !account.closed
  usageCount: number; autoCategoryRuleId: Id | null; autoCategoryId: Id | null;
  renameRules: RenameCondition[]; renameRuleId: Id | null }
interface RenameCondition { op: 'contains' | 'is' | 'startsWith' | 'endsWith'; value: string }

interface Schedule { /* see 12 §1 */ }
interface BudgetMonthView { /* see 09 §2 */ }
```

## 3. Mapping to Actual

| Domain | Actual source | Read | Write |
| --- | --- | --- | --- |
| Account core | `Account` (`id, name, offbudget, closed, account_group_id`) | `getAccounts()` | `createAccount(acc, initialBalance)`, `updateAccount`, `closeAccount`, `reopenAccount`, `deleteAccount`. Two traps (26.10.0): `closeAccount` **deletes** an account that has no transactions (Actual web does the same and says so in its close dialog, and the app follows it, `13` §4); and `deleteAccount` is a forced `closeAccount`, which **does nothing** to an account that is already closed. The app only deletes open accounts (force close), so it never hits this (`13` §4–5). |
| Account sort | `accounts.sort_order`, ascending, ties by name. `getAccounts()` returns this order. | AQL `q('accounts').select(['id','sort_order'])` | `updateAccount(id, {sort_order})`, with only that field. Fractional values are kept, so a drop between two accounts writes **only the moved account**, at the midpoint of its new neighbors' `sort_order` (or the last + 16384 at the end, the first − 16384 at the start). If two neighbors end up less than 0.001 apart, the host renumbers that list in steps of 16384, in one job. |
| Account balances | transactions | AQL sums (§6) | — |
| Account note | note id **`account-{accountId}`**. Actual web uses this prefix; found it, and the bare account id is **not** what Actual reads. | `getNote('account-' + id)` | `updateNote('account-' + id, text)` |
| Last reconciled | Actual's `accounts.last_reconciled`: the time the last reconciliation finished, in milliseconds since the epoch, stored as a **string** (Actual web sets it when "Done reconciling" runs and shows it in the account header). The API's `getAccounts()` doesn't return it. The host converts it to the local calendar date (`lastReconciledDate`); an empty or unparsable value means never reconciled. | AQL `q('accounts').select(['id','last_reconciled'])` | `updateAccount(id, { last_reconciled: String(Date.now()) })` at Finish (`13` §6.3), as Actual web writes it. The API passes the field through to Actual's account update; an integration test proves the write and the read-back. |
| Transaction | `Transaction` | AQL `q('transactions')….options({splits:'grouped'})` (§6) | `addTransactions(acct, [t], { runTransfers: true, learnCategories: false })`. This is an **options object**, and the API's `runTransfers` defaults to **false**. Always pass `cleared` explicitly, because new transactions otherwise default to **cleared = true**. Then `updateTransaction(id, fields)`, `deleteTransaction(id)`, `importTransactions`, `mergeTransactions`. **Update and delete resolve before the write lands**, so call them only through the settling wrappers (`03` §3). Explicit `id` on create is honored, but an id that was deleted **can't be reused**: the create is silently dropped. |
| Cleared/Reconciled | `cleared` (bool) + `reconciled` (bool) | AQL | `updateTransaction(id, {cleared, reconciled})` works. Actual stores `reconciled: true` with `cleared: false` without complaint, so the host MUST always write `R` as `{cleared: true, reconciled: true}` and `U`/`C` with `reconciled: false`. A split's children take the parent's `cleared`/`reconciled`. |
| Split | parent `is_parent` + `subtransactions` (children `is_child`, `parent_id`) | grouped query | Create: parent + full `subtransactions` (with `runTransfers: true` if any child has a transfer payee; each such child gets its own mirror). Update: **the parent with the full `subtransactions` array**. Children are matched by `id`: those with ids are updated in place, those without are created, and missing ones are deleted. Child fields left out are kept. Converting a normal transaction to a split this way works. Actual **accepts unbalanced splits** and only flags them with `error: SplitTransactionError`, so the host enforces Σ children = parent (§9) before writing. A direct `updateTransaction(childId, …)` also works, but the app doesn't use it. |
| Transfer | payee with `transfer_acct`; `transfer_id` links the sides | AQL | Set `payee` to the target account's transfer payee. Actual creates and maintains the other side. **Never write `transfer_id`** (except when importing). What showed is listed under the table ("Transfer behavior"). |
| Category group | `CategoryGroup` | `getCategoryGroups()`, which returns groups and their categories in `sort_order` order | `createCategoryGroup`, `updateCategoryGroup({name, hidden})`, `deleteCategoryGroup`. **`updateCategoryGroup` throws without `name`**, so always send the current name. `createCategoryGroup` **appends** the group after the last one (`sort_order` = last + 16384 in 26.10.0; the Budget Setup integration test relies on it). The same job still places it explicitly with `category-group-move`: at the top (`09` §4.1), or after the last expense group (`13` §2.1). If that handler is unavailable (`03` §3), the group stays wherever Actual put it. The integration test for the handler (`21` §1) records where Actual puts new groups. |
| Category | `Category` | `getCategories()` / groups | `createCategory`, `updateCategory({name, group_id, hidden})`, `deleteCategory(id, transferCategoryId?)`. **`updateCategory` throws without `name`**, so always send the current name. `createCategory` puts the new category at the **top** of its group. The app wants the end position, so the same job then calls `category-move` with `targetId: null`. |
| Category/group sort | `sort_order` (ascending) | AQL | **Not** through the update methods: Actual strips `sort_order` there. Reordering goes through the internal handlers `category-move` / `category-group-move` (`03` §3). |
| Deleting a category | — | — | `deleteCategory(id)` with **no** transfer category: its transactions become **uncategorized** (`category = null`) and show in the Uncategorized row. Its budgeted amounts are lost, and `totalBudgeted` / `toBudget` change. `deleteCategory(id, transferId)`: transactions are re-pointed to `transferId`, and the budgeted amounts are added to it. `deleteCategoryGroup(id)` behaves like deleting each of its categories without a transfer. The app uses the no-transfer form (classic behavior, `09` §6.1). |
| Category/group note | note id = the bare category/group id (verified against notes written in Actual web) | `getNote` | `updateNote` |
| Month note | note id **`budget-{YYYY-MM}`** (Actual web wrote the October 2026 month note as `budget-2026-10`) | `getNote` | `updateNote` |
| Category-month cell notes | reserved note `ad:cellnotes:{YYYY-MM}` (JSON) | `getNote` | `updateNote` |
| Budgeted amount | Actual budget | `getBudgetMonth(m)` | `setBudgetAmount(m, cat, amt)` (bulk inside `batchBudgetUpdates`) |
| Overspending handling | `carryover` | `getBudgetMonth` category `carryover` | `setBudgetCarryover(m, cat, bool)` |
| Deferred income | month "buffered"/hold | `getBudgetMonth` `forNextMonth` | `holdBudgetForNextMonth(m, amt)`, `resetBudgetHold(m)` |
| Payee | `Payee` (`id, name, category, transfer_acct`) | `getPayees()` | `createPayee`, `updatePayee`, `deletePayee`, `mergePayees(target, ids)` |
| Payee rename rules | `Rule` stage `pre`, conditions on `imported_payee`, action `set payee` | `getPayeeRules(id)` | `createRule`, `updateRule(full)`, `deleteRule` |
| Payee auto-category | `Rule` stage `default`, condition `payee is P`, action `set category` | `getPayeeRules(id)` | same |
| Rules (`23` §1) | `Rule` (`id, stage, conditionsOp, conditions, actions`), kept whole | `getRules()` | `createRule`, `updateRule(full)`, `deleteRule`; matching and Apply Actions through internal handlers (`03` §3) |
| Payee enabled | reserved note `ad:payees` | `getNote` | `updateNote` |
| Tags, review | User tags and `needs-review` in transaction `notes` | parse notes; `getTags()` for entities | rewrite notes (§5.1); create missing `needs-review` entity on open (§5.2) |
| Check number | token in transaction `notes` | parse | rewrite |
| Schedule | `Schedule` + its `Rule` | `getSchedules()` (`next_date` is system-managed), `getRules()` | `createSchedule({ posts_transaction: true, … })`, `updateSchedule(id, { payee, account, amount, amountOp, date, name, posts_transaction })`, `deleteSchedule`. The template (category, notes with `#needs-review`, splits) goes in the schedule rule's **actions**, via `updateRule`; integration tests confirm it is kept and applied when posting. Occurrence dates come from the internal `schedule/get-upcoming-dates`, and Skip from `schedule/skip-next-date` (`03` §3). Due occurrences are posted by Actual's schedule service (`12` §2). |
| Import account mappings | reserved note `ad:import-mappings` | `getNote` | `updateNote` |
| Number/date/currency and week-start formats | synced prefs `numberFormat`, `hideFraction`, `defaultCurrencyCode`, `currencySymbolPosition`, `currencySpaceBetweenAmountAndSymbol`, `dateFormat`, `firstDayOfWeekIdx`. All values are **strings** (`hideFraction` is `"true"`/`"false"`). `firstDayOfWeekIdx` uses `"0"` = Sunday through `"6"` = Saturday; when unset, Actuality follows the UI locale's week start until a value is explicitly chosen. A new budget has most of these prefs **unset**, and `defaultCurrencyCode` may be `""` (no currency). Defaults when unset: `numberFormat` → `comma-dot`, `hideFraction` → false, currency `""`/unset → no symbol with 2 decimals. Choosing a currency in Actual web also writes `flags.currency: "true"`. | `getPreferences()` | `setPreference` |
| Budget type | synced pref `budgetType`. Actuality supports only envelope budgets. **Unset (`undefined`) means envelope**, and that is how every never-switched budget reads. Actual's Tracking mode is out of scope: a budget whose pref is `'tracking'` is refused on open (`03` §6.1), and any other value is treated as envelope. | `getPreferences()` | read-only in this app |

**Transfer behavior**, for an edit on either side:

- `amount` (negated), `notes`, payee/account and `schedule` **propagate**.
- **`date` does NOT propagate.** The host writes the same date to the other side in the same job.
- `cleared`/`reconciled` stay per side. The mirror is created **uncleared**.
- A category on an on↔on transfer is cleared by Actual. An on→off transfer keeps its category on the on-budget side.
- Pointing the payee at another account moves the **same** mirror row. Changing it to a normal payee deletes the mirror.
- Deleting either side deletes the other. A split child's mirror is unlinked instead of deleted, so whenever the host deletes a split, or removes a transfer line from one, it deletes those mirrors itself in the same job (`10` §8, `11` §6).
- Moving one side to another account (`updateTransaction({account})`) re-points the other side's payee.

## 4. Built-in names & special entities

| Item | Actual realization |
| --- | --- |
| Income master ("Income") | Actual's single income `CategoryGroup` (`is_income`). Its categories are the income categories. Not shown on the envelope budget grid (X1). |
| "Split (Multiple Categories)..." | not a category. A split = transaction with subtransactions. |
| "Uncategorized Transactions" | synthetic budget row (`09` §4.2), computed from transactions with `category = null` (§7). |
| "Hidden Categories" | synthetic budget row listing hidden categories and categories of hidden groups (X10). |
| "Starting Balance" payee | Actual creates starting balances itself when `createAccount(acc, initialBalance)` runs (`starting_balance_flag`). The app keeps it as Actual made it (`13` §2). |

## 5. Metadata encoding (D1)

### 5.1 Transaction `notes` codec (`src/shared/metadata/notes-codec.ts`)

Actual's `notes` field holds the user's text, including any number of tags, plus optional application metadata:

```text
{notes}[ ⟦chk {checkNumber}⟧][ #needs-review]
```

- `#needs-review` remains the one app-owned tag: it marks transactions that require approval. User-created tags are ordinary Actual tags and stay in the notes text. Existing `#flag-red`, `#flag-orange`, `#flag-yellow`, `#flag-green`, `#flag-blue` and `#flag-purple` values are treated as ordinary user tags; they are never migrated, removed or assigned special behavior.
- Check number token: `⟦chk 1234⟧` (U+27E6/U+27E7). It uses no `#`, so it doesn't create a tag per check number. The check # field is free text, so `encode` drops any `⟦`/`⟧` from it: a bracket inside the token would end it early and leak the rest into the notes.
- **Actual's tag syntax:** a tag is `#` followed by one or more characters other than whitespace and `#`, not preceded by another `#`. Actual's regex is `(?<!#)#([^#\s]+)`. Matching is **case-sensitive**. Consequences:
  - `#tag` and `#TAG` are different tags.
  - Whitespace ends a tag; punctuation is part of it, so `#trip,` is a different tag from `#trip`.
  - `##not-a-tag` escapes the first `#`; Actual displays it as literal `#not-a-tag`.
  - `word#tag` is a tag, as it is in Actual.
  - Anything not recognized as a tag stays in `notes` unchanged.
- **decode(notes)**: find and remove only the check-number and exact `#needs-review` metadata tokens anywhere in the text (users may edit notes in Actual). With more than one check-number token, the last is the check number (where `encode` writes it) and the others stay in `notes` as text, so nothing the user typed is lost. `notes` = the remaining text with whitespace collapsed at the join points and trimmed. Derive `tags` from every Actual hashtag in the remaining text; preserve the original tag spelling and all non-metadata text.
- **encode(notes, chk, review)**: notes trimmed + the check-number and review tokens in canonical order. User tags remain wherever the user placed them. An empty result → `null`/empty notes.
- **Round-trip guarantee:** two unit-tested properties:
  - `decode(encode(x)) == x` for every x whose notes is **normalized** (trimmed, with no runs of whitespace) and contains no app-owned check or review token. User tags, including former `#flag-*` tags, round-trip as text.
  - `encode(decode(n))` changes `n` only by moving and normalizing known tokens, for **any** string `n`. The app re-encodes notes **only when a transaction is written**. It never rewrites notes in bulk on its own.
- **Transfers share one `notes` value.** Actual copies the whole `notes` field to the other side on every edit, from either side. So the notes, user tags, check number and review tag of a transfer are **shared by both sides**: writing side B's notes would immediately overwrite side A's. The app treats these as properties of the transfer *pair* (deviation X22). Editing them on either side changes both, and the register shows the same values on both. Split children with a transfer payee share notes with their mirror in the same way.
- Search, export and print use `notes` (decoded), never `rawNotes`.

### 5.2 Tag entities

- A tag entity is an Actual `Tag` (`id`, `tag`, optional `color`, `description`, `hidden`). It supplies the shared color and description for a tag name found in transaction notes. Notes can contain tags even when no entity exists; adding a tag to notes does not create its entity. Actual's Tags manager can **Discover new tags** already used in notes; the app's `tags.discover()` calls Actual's `tags-discover` operation.
- The host reads entities with `getTags()` and uses Actual's `createTag`, `updateTag` and `deleteTag` APIs, plus the internal `tags-discover` and `tags-rename` (`03` §3). It does not overwrite existing colors or descriptions automatically. `#needs-review` is the only app-owned tag entity; at the first transition to `Online` (a session start task, `03` §6.4), create it if missing, with the review color in `05` §1.7. Do not recreate a user tag that was deleted.
- Tag names are case-sensitive and cannot contain whitespace or `#`. The `#` prefix is omitted when creating a managed tag; it is added to notes when used. Tags can be added anywhere in Notes, multiple tags may appear in one note, and each tag renders as a colored `#name` pill. `##` escapes a literal `#`.
- The Tags manager is available from Preferences (`07` §7). It lists managed tag names, colors, and descriptions; supports creating tags, discovering tags already used in notes, changing colors and descriptions, renaming, deleting, and viewing transactions with a tag. Names are unique case-sensitively. Adding an existing tag updates its color rather than creating a duplicate. Renaming uses Actual's internal `tags-rename` operation (`03` §3), which renames the entity and rewrites that exact, case-sensitive hashtag in transaction notes; the public `updateTag` renames only the entity (26.10.0), so it is used for colors and descriptions only. Actual refuses a rename onto a name already in use, including the name of a deleted tag (it keeps deleted tags as tombstones, which the Tags manager doesn't list); the host reports both cases as a `validation` error with `details.code = 'duplicate-tag'`, and the Tags manager shows "Tag name already in use" instead of "Something went wrong". A name already in the list is refused before the rename confirmation. Deleting removes only the tag entity; the hashtag text remains in notes and can be discovered again.
- `needs-review` is protected from rename and delete in Actuality because it drives approval state. If renamed or deleted externally, the app does not reinterpret the replacement as review metadata; it restores the missing `needs-review` entity at the next session start. Do not treat `flag-*` names as protected.

### 5.3 Reserved notes

Notes are keyed by an arbitrary id. The reserved-note scheme is:

- `updateNote` is a plain upsert on the `notes` table.
- Notes with `ad:…` ids persist exactly, including unicode, newlines and the `⟦⟧`/`#` tokens, at sizes up to at least 1 MB.
- They sync through the server to a fresh second device.
- Unlike `updateTransaction`, `updateNote` has landed when it resolves.

All reserved ids start with `ad:`. Content is JSON with a schema version and is validated with zod. Unknown fields are preserved on write.

**Loading:** on budget open (and on `data:changed`), the host loads **all** reserved notes in one ActualQL query:

```ts
q('notes').filter({ id: { $gte: 'ad:', $lt: 'ad;' } }).select(['id', 'note'])
```

`;` is the character after `:`. `$like` can't be used: it fails on the `id` field with "Can't convert id to string". Individual reads use `getNote(id)`, which returns `{ id, note }` or `null` for an id never written.

| Note id | Schema (v1) |
| --- | --- |
| `ad:payees` | `{ v:1, disabled: Id[] }` |
| `ad:cellnotes:{YYYY-MM}` | `{ v:1, notes: Record<CategoryId, string> }` |
| `ad:import-mappings` | `{ v:1, mappings: { key: string /* '{fid}\|{acctId}' (OFX/QFX) or 'qif\|{number}'; 16 §1.4 */, accountId: Id \| null /* null = skip */, importNotes: boolean, swapPayeeNotes: boolean, dateOrder?: 'MDY'\|'DMY'\|'YMD' }[] }` |
| `ad:budget` | `{ v:1, carryoverSeenEnd?: Month /* carryover extension, 09 §6.4 */ }` |

Rules:

- Read-modify-write runs inside **one queue job**. Concurrent edits from another device are last-writer-wins on the whole note (Actual's CRDT works per field). This is acceptable for this low-contention data and documented in `19`.
- `ad:import-mappings` is checked entry by entry: an entry this version can't read (an unknown date order, a newer app's shape) isn't used, and it is kept as it is when the note is rewritten. Only a note whose outer shape is wrong (not JSON, no `v: 1`, no `mappings` array) is invalid as a whole.
- Invalid JSON: reads treat it as empty. Before the first overwrite, the old text is copied to `ad-bak:{id}` (for example `ad-bak:ad:payees`), and a warning is logged. The `ad-bak:` prefix sorts outside the `'ad:'`…`'ad;'` range (`-` comes before `:`), so the loader above never reads a backup as metadata.
- **Notes can't be deleted**. The `notes` table has no tombstone, so a note can only be set to `""` (a later `getNote` returns `{note: ""}`) or `null`. The app writes `""` to clear a note, and treats `""`, `null` and a missing row the same way: no note. Deleting a category or account in Actual does **not** clear its note.
- When the app deletes an account, its native note `account-{id}` is cleared with `""`. When it deletes a category (or a group with its categories), the same job removes their entries from every `ad:cellnotes:{YYYY-MM}` that holds one. A month note that isn't valid JSON is left as it is.

## 6. ActualQL queries used (host)

All queries go through `aqlQuery`, wrapped in `actual.ts`. `runQuery` is deprecated. Integration tests confirm every field and join used below against server 26.2.0: all 18 register fields, `accounts.sort_order`, `categories.sort_order`, and the joins `account.offbudget`, `account.name`, `payee.transfer_acct`, `payee.transfer_acct.offbudget`, `category.name` and the two-level `category.group.hidden`. Dotted paths work in **both** `filter` and `select`. Deleted (tombstoned) rows are excluded by default.

```ts
// Register (one account or all), split-aware
q('transactions')
  .filter(accountId === 'all' ? {} : { account: accountId })
  .select(['id','account','date','amount','payee','category','notes','cleared','reconciled',
           'transfer_id','imported_id','imported_payee','is_parent','is_child','parent_id',
           'schedule','starting_balance_flag','sort_order'])
  .options({ splits: 'grouped' })

// One transaction (`transactions.get`): the register query filtered by the parent's id. Grouped, it
// returns the split with all its lines (integration-tested on 26.2.0 and latest). A line's
// id is first mapped to its parent_id; conversion is per transaction, so it equals the list entry.
q('transactions').filter({ id: parentId }) /* same select */ .options({ splits: 'grouped' })

// Account balances (inline: children summed, parents excluded — totals equal parents)
q('transactions').filter({ account: id }).groupBy(['cleared','reconciled'])
  .select(['cleared','reconciled', { total: { $sum: '$amount' } }])   // options default inline

// Uncategorized in month (§7; the Uncategorized row) — verified
q('transactions').filter({ 'account.offbudget': false, category: null,
    $or: [{ 'payee.transfer_acct': null }, { 'payee.transfer_acct.offbudget': true }],
    date: { $transform: '$month', $eq: month } })
  .select(['id', 'amount'])                                          // inline: split children included

// Category spend per month (Quick Budget history)
q('transactions').filter({ 'account.offbudget': false, category: { $ne: null }, date: { $gte: from, $lte: to } })
  .groupBy([{ $month: '$date' }, 'category'])
  .select([{ month: { $month: '$date' } }, 'category', { total: { $sum: '$amount' } }])
```

- **`splits` option:** `inline` (the default) returns normal rows and split **children**, with no parents. Use it for every sum. `grouped` returns normal rows and **parents** with `subtransactions`, for the register. `all` returns parents and children as flat rows. `none` returns parents without children. On one test account with a 2-way split these returned 10 / 9 / 11 / 9 rows.
- The balance `groupBy` total equals the sum of the inline rows exactly, because split parents aren't double-counted.
- **Starting balance:** the row `createAccount(acc, initialBalance)` creates has `starting_balance_flag: true` and is **categorized** with Actual's income category "Starting Balances" (for an on-budget account), and the app keeps it (`13` §2).
- `$like` is SQLite `LIKE`: **case-insensitive for ASCII only**. The register search (`10` §4) matches in TypeScript on decoded `notes` (`04` §5.1), so it doesn't depend on this.

- Transfers between two on-budget accounts are excluded from "uncategorized" (§7).
- Performance target: register query for 20,000 transactions < 1.5 s on mid-range hardware (`21` §5). measured **168 ms** for 20,400 rows with all 18 fields, grouped. Balances took 12 ms and a 12-month category `groupBy` 13 ms, on the dev machine with `@actual-app/api` 26.10.0 in plain Node. No paging is needed. Re-measure in the packaged app (`21` §5).

## 7. Derived transaction states (`src/shared/domain/error-state.ts`)

Computed client-side after load. Applied to each transaction and to each subtransaction. A split parent takes the highest child level. Rank: error 10 > forReview 5 > needsCategory 1 > none 0.

Definitions:

- *onBudget(t)* = the transaction's account is on-budget.
- *isOnBudgetTransfer(t)* = `transferAccountId` set and the target account is on-budget.
- *isOffBudgetTransfer(t)* = `transferAccountId` set and the target account is off-budget.

| Level | Condition | Message (exact) |
| --- | --- | --- |
| `error` | onBudget ∧ isOnBudgetTransfer ∧ `categoryId ≠ null` | "This transaction is transferring money to/from another on-budget account, and thus should not be categorized. (Transfers between on-budget accounts don't affect your budget)." |
| `error` (split parent) | any child is `error` | "This split transaction has the following problems:\n\n" + "\t- {child message}\n\n" per problem child |
| `forReview` | `needsReview` tag present, and the current level ≤ forReview (it replaces needsCategory) | if `scheduleId` (entered by the scheduler): "This transaction was entered by the Scheduler and needs to be reviewed. Click it, review it, and then approve or reject (delete) it." else: "This transaction was imported and needs to be reviewed. Click it, review it, and then approve or reject (delete) it." |
| `needsCategory` | onBudget ∧ `categoryId = null` ∧ not split ∧ `amount ≠ 0` ∧ not a transfer | "This transaction must be categorized. (Standard transactions in budgeted accounts must be categorized so that the budget knows about it.)" |
| `needsCategory` | onBudget ∧ isOffBudgetTransfer ∧ `categoryId = null` | "Transfers to/from off-budget accounts must be categorized. (When money goes in or out of budgeted accounts, it must be categorized so that the budget knows about it.)" |

(The double spaces before "(" are intentional and match the reference design.)

Other state rules:

- Setting cleared to `C` or `R` also approves (removes `needs-review`), as in the reference design (`10` §6.1, §6.4). Setting `U` doesn't.
- Imported transactions are created Cleared (`defaultCleared: true`) and tagged `needs-review`.
- Approving one side of a transfer also approves the other side. This happens automatically, because the `needs-review` tag lives in the shared notes (§5.1).

**Account attention** = count of transactions with level ≠ none (a split parent counts once); `maxLevel` = the highest level.

## 8. Balances

```text
reconciledBalance = Σ amount where cleared = R
clearedBalance    = Σ amount where cleared ∈ {C, R}
unclearedBalance  = Σ amount where cleared = U
workingBalance    = clearedBalance + unclearedBalance
```

- Every entered transaction counts, regardless of date. Unentered scheduled occurrences never count.
- Sidebar totals: on-budget open accounts, off-budget open accounts, closed accounts. All Accounts = Σ every account. Assets = Σ positive working balances, Liabilities = Σ negative, Net worth = Σ all.
- Running balance: cumulative over the account's **unfiltered** transactions, in the balance calculation order defined by `10` §7.4. Display sorting by other columns does not change the balance assigned to a transaction.

## 9. Invariants enforced by the host

- Split: Σ children = parent amount at commit (`11` §7.3 dialog runs before the write).
- No transfer to the same account. No split parent that is itself a transfer.
- On-budget↔on-budget transfers have no category (the editor prevents it; existing data is flagged `error`). On-budget↔off-budget transfers need a category on the on-budget side (flagged `needsCategory`).
- Category and group names: non-empty, and no `:` or `` ` ``. Group name ≠ "Income" (case-insensitive) and not reserved ("Hidden Categories", "Uncategorized Transactions", "Add New Category..."). Category names are unique within a group. Group names are unique.
- Account names: non-empty, unique (case-insensitive), no `` ` ``.
- Reconciled transactions only change after the confirmation in `11` §6.
