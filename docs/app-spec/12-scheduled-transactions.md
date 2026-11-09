# 12 — Scheduled Transactions

Scheduled (recurring or future one-time) transactions live in the **Scheduled Transactions** pane at the bottom of the register. They don't count in balances or the budget until they're entered into the register. They're stored as Actual **schedules** (X15), and due occurrences are posted by **Actual's own schedule service** (§2).

## 1. Model & Actual mapping

```ts
interface Schedule {
  id: Id; name: string | null;           // Actual name (unique if set); edited in the Schedule dialog (§3.1)
  accountId: Id | null;
  nextDate: ISODate;                      // Actual's next_date (system-managed; advanced by Actual's service)
  frequency: Frequency | 'custom';
  twiceAMonthStartDay: number | null;     // 1–15, TwiceAMonth only
  payeeId: Id | null; transferAccountId: Id | null;
  categoryId: Id | null; notes: string;                     // includes user tags from the schedule's rule actions
  amount: Money; amountOp: 'is' | 'isapprox' | 'isbetween'; // isbetween → amount = num1 (shown), amount2 = num2
  amount2: Money | null;                  // isbetween only
  subtransactions: ScheduleLine[];        // rule split actions
  postsTransaction: boolean;              // Actual posts_transaction; "Automatically add transaction" (§3.1)
  completed: boolean;                     // Actual completed (Once schedules after posting); hidden from the pane
  raw: { date: string | RecurConfig; ruleId: Id };
}
type Frequency = 'Once' | 'Daily' | 'Weekly' | 'EveryOtherWeek' | 'TwiceAMonth' | 'Every4Weeks'
  | 'Monthly' | 'EveryOtherMonth' | 'Every3Months' | 'Every4Months' | 'TwiceAYear' | 'Yearly' | 'EveryOtherYear';
```

Display names (also the Frequency combo order): "Once", "Daily", "Weekly", "Every other week", "Twice a month", "Every 4 weeks", "Monthly", "Every other month", "Every 3 months", "Every 4 months", "Twice a year", "Yearly", "Every other year". Plus read-only "Custom" for Actual configs the app can't express.

**Frequency ↔ Actual `date`** (`src/shared/schedule/`):

| Frequency | Actual `date` |
| --- | --- |
| Once | plain date string `YYYY-MM-DD` |
| Daily | `{frequency:'daily', interval:1, start, endMode:'never'}` |
| Weekly / EveryOtherWeek / Every4Weeks | `{frequency:'weekly', interval:1 / 2 / 4, start, endMode:'never'}` |
| Monthly / EveryOtherMonth / Every3Months / Every4Months / TwiceAYear | `{frequency:'monthly', interval:1 / 2 / 3 / 4 / 6, start, endMode:'never'}` |
| TwiceAMonth | `{frequency:'monthly', interval:1, start, endMode:'never', patterns:[{type:'day', value:d1}, {type:'day', value: d1+15 ≤ 28 ? d1+15: -1}]}` (`-1` = last day of month) |
| Yearly / EveryOtherYear | `{frequency:'yearly', interval:1 / 2, start, endMode:'never'}` |

- Reverse mapping: anything else (other intervals, weekday patterns, `skipWeekend`, end modes other than `never`) → `'custom'`. The Frequency column then shows a generated description (e.g. "Every 3 weeks", "Monthly on the last Friday", "Monthly, skipping weekends, 12 times"). Custom schedules are editable: the Schedule dialog (§3.1) edits every part of a `RecurConfig` that Actual's own schedule editor does. It keeps the config's fields it doesn't know about.
- **Presets** (§3.1): the dialog's Frequency select offers the 12 recurring frequencies above as presets. Choosing one writes only `frequency`, `interval` and `patterns` (Twice a month: the two days from the start date). The end condition and the weekend move stay as the user set them. The select shows the preset whose `frequency`, `interval` and `patterns` match the config, ignoring its end and weekend settings, or "Custom" when none does.
- **Occurrences** from today on always come from Actual. The public API has no occurrence method, so `actual.ts` wraps the internal handler `schedule/get-upcoming-dates { config, count }` (`03` §3). It returns the next `count` dates **from today** (the handler starts its rule at `config.start` but takes occurrences from `startOfDay(new Date())` in the 26.11.0 source), using Actual's own month-end, last-day (`-1`) and weekend rules. The app does no date math of its own for dates from today on. To get the occurrences in a range, pass the schedule's own `date` config unchanged (moving `start` would shift the pattern's phase), keep the dates inside the range, and ask again with a doubled `count` (12, 24, 48…, at most 400) until the last date passes the range end. Occurrences before today can't be listed this way, so for those alone the app computes them as Actual does: `shared/schedule/occurrences.ts` ports Actual's `recurConfigToRSchedule` and rschedule's RFC 5545 rules (26.11.0): days and weeks step by the interval; a monthly or yearly date without patterns is the start's day, skipped in months too short for it (so Feb 29 only in leap years); `day` patterns skip days past the month's end and read `-1` as the last day; weekday patterns pick the nth (or, negative, the nth from last) weekday; a config with both kinds of pattern is two rules, each with its own `endOccurrences` count; an `on_date` end is included; and weekend dates move as `get-upcoming-dates` moves them, after the bounds are applied. An integration test checks the port's dates from today on against the handler's for every frequency and for patterns, counts, end dates and weekend rules.
- `nextDate` is Actual's `next_date` from `getSchedules()`. It is **system-managed**: `updateSchedule` rejects it. Actual sets it when the `date` changes, and advances it when an occurrence is posted, paid or skipped (§2, §3).
- **The schedule's rule** (`getRules()`, the rule whose id is the schedule's `rule`; `stage: null`) has conditions on payee, account, date and amount, plus the action `link-schedule`. Integration tests confirm that the app can add and edit **actions** on it with `updateRule`, and that `updateSchedule` keeps them. The app stores the transaction template there:
  - `set category`;
  - `set notes` = `encode(notes, null, needsReview = true)` (`04` §5.1). It is **always** present on schedules the app writes, so every posted occurrence arrives tagged `#needs-review` (§2);
  - splits as Actual's split actions: `set-split-amount { splitIndex: n, method: 'fixed-amount' | 'remainder' }`, plus `set category` (and `set notes`) with `options.splitIndex: n`. Integration tests confirm a posted occurrence is a real split. Actual left the posted split parent's **payee empty**, so the app shows the schedule's payee on such parents and fills `payee` when the user edits one.
  - The `link-schedule` action and any actions the app doesn't understand are preserved.
- Defaults for a new schedule: Repeats on, Monthly, starting **tomorrow**, ending never, no weekend move, no name, no category, "Automatically add transaction" on (`posts_transaction: true`), amount operator `is`.
- A schedule with no payee: `createSchedule` would write a payee condition for the text "null", so the rule update of the same job removes the payee condition.
- **Name:** optional; Actual trims it and requires it to be unique among schedules. An empty name is saved as `''`, which Actual stores as no name (`updateSchedule` would write `null` as the text "null"). A taken name is refused by the host with `details.code: 'name-taken'`.
- **Amount operator:** `is` ("is exactly"), `isapprox` ("is approximately": Actual matches ±7.5%) or `isbetween` ("is between": `{ num1, num2 }`, either order, both inclusive). The app writes `num1` and `num2` with the same sign, the smaller magnitude first, so `amount` (`num1`) is the one the pane, Enter now and Quick Budget use (§3, §5).
- **Dates the app accepts:** a Once date can't be before today (unchanged dates of existing schedules are not checked). A recurring start date may be in the past: Actual's `next_date` is the first occurrence from today on, and earlier occurrences are not posted. A recurring config needs at least one occurrence from today on (`get-upcoming-dates` with `count: 1`). Without one, Actual would set `next_date` to the last past occurrence and its service would post it, so the host refuses with `details.code: 'no-upcoming'`. An end date before the start date is refused the same way.
- **Unchanged dates aren't rewritten:** `updateSchedule` resets `next_date` whenever the date or account condition changes (26.11.0). So when the edited config deep-equals the stored one, the host leaves `date` out of the update, and a skipped occurrence stays skipped.
- Scheduled transactions never have an error state.

## 2. Automatic entry: Actual's schedule service

The app does **not** enter due occurrences itself. **Actual's own schedule service** does it. That service runs inside every Actual client, **including the app's API host**: opening a budget from a fresh cache makes the host post a missed schedule. Desktop therefore shares one mechanism with Actual web, and there is no app-side double-entry logic.

**When it runs:** after the **first successful sync of each local day** in that client. The day is tracked by `lastScheduleRun` in the API's cache, not by the app. In Desktop that is the sync after `downloadBudget` on open, or the first periodic sync (`03` §4.1) after midnight while the app is open. Since 26.11.0, creating or updating a schedule that has `posts_transaction` also clears `lastScheduleRun`, so the service runs again after the next successful sync that day. A schedule saved due today, or a Once dated earlier, is posted within seconds, by the sync Actual starts about 1 s after the write. It **posts** only after a *successful* sync, so it never enters occurrences while offline, which matches the write gate (`03` §5). But it also **runs after a failed sync** (`error` or `unauthorized` events, in the 26.10.0 and 26.11.0 source). In that pass it skips posting, yet still advances `next_date` for paid recurring schedules and completes paid Once schedules. These are Actual's own writes, made while the gate is closed. In a server session they are recorded and pushed by the next successful sync, and the host counts them as unsynced changes (`03` §4.1). `lastScheduleRun` is only saved after a success, so the pass repeats on every failed sync until one succeeds. A local-only session never syncs (`03` §6.2), so the service doesn't run there.

**What it does**, for each schedule that isn't completed and whose account isn't closed:

| Schedule | Behavior |
| --- | --- |
| `posts_transaction: true`, due today or missed | Posts every due occurrence up to today, one transaction each, catching up on missed ones. Each is dated its occurrence date, **uncleared**, with account, payee and amount from the conditions and the rule's actions applied: category, notes and splits. The app always sets `#needs-review` in the notes, so occurrences arrive needing review. `next_date` advances past each missed occurrence it posts. After the one due today it stays on today, and the next day's run moves it on. A posted Once schedule becomes `completed` at a later day's run. |
| any, with a **linked** transaction (`schedule = id`) for the current occurrence, once its date has passed | `next_date` advances to the next occurrence ≥ today. A Once schedule becomes `completed`. |
| `posts_transaction: false`, unpaid | Nothing. It stays "missed" until entered or skipped (§3). The user turns this on by clearing "Automatically add transaction" (§3.1), or in Actual web. The pane shows them with the badge "Not entered automatically". |

**In the app:**

- Posted occurrences are ordinary transactions with `schedule` set and `#needs-review`. They show bold with the blue reminder icon and the message "This transaction was entered by the Scheduler and needs to be reviewed. Click it, review it, and then approve or reject (delete) it." (`04` §7). Approving removes the tag. Rejecting deletes the transaction, and Actual won't post that occurrence again because `next_date` has already moved past it.
- The service runs fire-and-forget after the sync resolves. Its posts are local writes made while no host job is running, so they arrive as `applied` sync events with `tables` including `transactions`. The host turns those into `data:changed` (`03` §4.1), and the posted rows appear. Actual then auto-syncs them about 1 s later.
- **Deviations** (X15, X23):
  - The original app's "Is your computer's clock correct?" prompt on date jumps is gone. Actual posts every missed occurrence without asking.
  - Two devices that both run the service before either has synced could, rarely, both post the same occurrence. That is Actual's own behavior, and the duplicate shows up for review.
- **Matching transactions are linked.** When the user enters a transaction (in the app or anywhere else) that matches a schedule's payee, account, amount and approximate date, Actual's rules link it to that schedule, which counts as paying the occurrence. They also apply the schedule's `set` actions: category, notes including `#needs-review`, and splits. This is Actual's behavior (deviation X23).
- **The app restores what the user entered.** After every create or update the app makes (commit pipeline `11` §6, **Enter in register now** §3, import `16` §1.5), the same job reads the row back. If Actual linked it to a schedule (`schedule` set by the rule, or by us for Enter now), the job writes back in one `updateTransaction`:
  - `notes` as the app wrote them: the user's notes and tags, plus any check number. A transaction the user entered or entered-now is **approved** (no `#needs-review`). An imported row keeps its review tag (`16` §1.5).
  - The category and splits the user entered. Only if the user left the category **empty** (not a split) are the schedule's category and splits kept.
  - The link (`schedule`) is kept, so the occurrence still counts as paid.

  The settling wrapper (`03` §3) excludes `notes`, `category` and `subtransactions` from its first "until" check when the row comes back linked, because Actual rewrote them. The restoring update is then settled normally. After such a commit, the editor shows the notifier "Matched to scheduled transaction '{payee}'". Transactions entered in other Actual clients are left as Actual made them.
- **Rules don't run on updates.** Integration tests show linking only on **create**; `tests/int/schedules.int.test.ts` shows that an update which makes a transaction match a schedule neither links it nor applies the rule's `set` actions (server 26.2.0; in the 26.11.0 source only adding transactions (`addTransactions`, and `importTransactions` through its matching step) and the transfer mirror run rules). So the restore works as written.

## 3. Scheduler pane UI

- Title bar (`--bar-h`, header background) with the centered title pill **"Scheduled Transactions"** (italic `lg`) and, on the left with gap `--space-3`, the same action buttons as the register toolbar (`10` §3): **Edit Transactions ▾** (same label logic), **Add** (plus icon) and **Transfer** (transfer icon). The pill stays centered in the bar; when the pane is too narrow for that, it moves right rather than overlap the buttons.
- Grid columns: Select, Account (All Accounts only), **Date** (next occurrence), **Frequency**, Payee, Category, Notes, Outflow, Inflow. Notes uses the register's default width (`10` §2) and can be hidden. Tags appear as colored `#name` pills in Notes and can be clicked to filter the register (`10` §6.2). Right-click a header, or press Shift+F10 on a focused one, for the column chooser (as in the register, `10` §2), with "Apply current settings to all existing accounts".
- Selection follows `10` §9: Ctrl/Cmd-click toggles a row, and Shift-click selects the inclusive range from the selection anchor, including when clicking a row checkbox. The header checkbox selects all or clears the selection; with a partial selection it shows an indeterminate (horizontal dash) icon and clicking it clears that selection. Row checkboxes reflect selection immediately when clicked.
- **Add** and **Transfer** both open the Schedule dialog on a new schedule (§3.1); **Transfer** opens it with the payee field holding `Transfer:` and its list open. **Transfer** is shown only when an open account other than the new schedule's account exists (in All Accounts, the first open on-budget account, as for a new transaction, `11` §2). Offline, both stay focusable with `aria-disabled="true"` and the tooltip "Editing is unavailable while offline" (`03` §5.3, `22` §4.6). There is no add bar under the last row. Actual's service posts a transfer schedule's occurrence **with its mirror** in the other account (`tests/int/schedules.int.test.ts`), so transfer schedules are edited like any other.
- **No inline editing:** the pane is a list. Schedules are created and edited only in the Schedule dialog (§3.1). A click selects, as in the register (`10` §9). A double-click on a row, Enter or F2 on the single selected row, or **Edit Schedule…** in the actions menu opens the dialog on that schedule. All of these require `canEdit`.
- Sorted by date by default. Sort and columns are saved per account (`19` §2).
- The pane lists schedules that aren't `completed` and whose `accountId` is this account (or all of them in All Accounts). Schedules with no account (possible in Actual) appear only in All Accounts.

### Scheduled actions menu (button or right-click; title "1 selected scheduled transaction" / "{n} selected scheduled transactions")

| Item | Behavior |
| --- | --- |
| **Edit Schedule…** | Opens the Schedule dialog (§3.1) on the schedule. Only with exactly one selected. |
| — | |
| **Enter in register now** | For each selected, in one job: `addTransactions(account, [{ date: nextDate, schedule: id, payee, amount, category, notes: encode(notes, null, false), subtransactions, cleared: false }], { runTransfers: true })`. That is the occurrence, **approved** (no review tag), linked to the schedule. If Actual's rule rewrites its notes or category on the way in, the same job restores them (§2). Then advance: internal `schedule/skip-next-date { id }` for recurring schedules (`03` §3), or `deleteSchedule` for Once. Linking alone would only advance the schedule after its date passes (§2). Then select the new register rows, clear the scheduler selection, and scroll the register to the new rows. |
| **Skip this payment** | Internal `schedule/skip-next-date { id }`: `next_date` moves to the following occurrence without entering anything. No effect on Once. Fallback if the handler is unavailable (`03` §3): the item is disabled, with the tooltip "This version of Actual doesn't support skipping from Actuality". |
| — | |
| **Delete** | Delete the selected schedules (no confirmation, no undo). |
| — | |
| **Move to account ▸** | Change the account. The sub-menu lists every open account except the current one. Disabled when empty. The host refuses (`transfer-into-target`) a schedule that is a transfer into the target, or a split with a transfer line into it, as for transactions (`10` §6.1). |

All are disabled offline.

### 3.1 Schedule dialog

A standard dialog (`17` §2), width `xl`, modeled on Actual web's schedule editor plus the transaction template the app keeps on the rule (§1). Title **"Add Schedule"** for a new schedule (also from the register, §4), **"Edit Schedule"** otherwise. It edits a copy: nothing is written until **Save** (**Add** for a new schedule), and **Cancel**, Esc or ✕ discard everything, link changes included. Like the register editor's buttons (`11` §2), Save / Add is green (`<UiButton primary tone="save">`, keeping the check icon) and Cancel is red (`<UiButton tone="cancel">`); the CVD palettes make them blue and orange (`05` §1.8). It opens only while `canEdit`. If the connection drops while it's open, Save shows the offline dialog and the dialog stays open.

Fields, top to bottom:

1. **Schedule name** (text, placeholder "Optional"), **Payee** (the register's payee auto-complete with the transfer entries, `11` §4.1, and the same refusals: an unknown transfer account, a transfer to itself, a transfer on a split), **Account** (a select of the open accounts; an existing schedule's closed account is listed too). Payee auto-fill (`11` §4.3) does not run here.
2. **Amount**: the operator select ("is exactly", "is approximately", "is between"), a segmented **Outflow** / **Inflow** choice, and the amount (`MoneyInput`, a magnitude). "is between" shows a second amount after the word "and". "is approximately" shows the hint "Matches amounts within 7.5%."
3. **Category**: the register's category auto-complete with **Split** (`11` §4.2; Add New Category included). It's disabled with the placeholder "Category not needed" for an off-budget account or an on↔on transfer, as in the register. **Split** shows the split lines below. Each line has a transfer-or-category field, Notes, and Outflow and Inflow amounts. There are **Add line** and a delete button on each line, plus the "Remaining" amount. Lines can't be added to a transfer (the register's "can't split" message). On save the register's split rules run (`11` §7.3): empty lines go, a single line collapses, and an unassigned remainder asks first. The lines add up to the amount (`num1` for "is between").
4. **Notes**: the register's notes field with tag suggestions (`11` §2).
5. **Date**: a **Repeats** checkbox.
   - Off (Once): **Date** (`DateField` in its scheduler mode: before today → "Selected date is outside range: '**{text}**' Transactions can't be scheduled before today", `11` §3).
   - On: **Frequency** (the preset select, §1; "Custom" when no preset matches, and choosing it changes nothing); **Starts** (a date, past dates allowed, §1); **Repeat every** [n] [day(s) / week(s) / month(s) / year(s)] (n from 1 to 999); for monthly schedules only, **Add specific days**: rows of [which] [Day of the month / Sunday … Saturday] with a delete button each, read as "15 Day of the month" or "Last Friday". Day of the month offers 1–31 and Last (`-1`); a weekday offers first–fifth and Last. Changing a row to a weekday turns a value above 5 into "first". The days are written as `patterns: [{ type: 'day' | 'SU'…'SA', value }]`; changing the unit away from monthly drops them. **Ends**: Never, After [n] occurrence(s) (`endMode: 'after_n_occurrences', endOccurrences`, default 1), On [date] (`endMode: 'on_date', endDate`, default the start date). **Move the date when it falls on a weekend** [to the Friday before / to the Monday after] (`skipWeekend`, `weekendSolveMode`, default after). A monthly schedule on the 29th–31st (its start day when it has no specific days, or a Day of the month row) shows the hint "Months without this day are skipped." (Actual's behavior).
   - **Upcoming dates**: the next 5 occurrences from Actual (`schedules.preview`, §1), refreshed 300 ms after the date fields change; "No upcoming dates" when there are none. It is hidden when `get-upcoming-dates` is unavailable (`03` §3).
6. **Automatically add transaction** (checkbox, `posts_transaction`), with the help text "Actual enters the transaction in the register on its date. Turn this off to enter or skip each one yourself."
7. **Transactions**: a segmented choice **Linked transactions** / **Find matching transactions** over a small table (checkbox, Date, Payee, Account, Notes, Amount; date descending). It opens on Linked for an existing schedule and on Find matching for a new one.
   - Linked: the transactions whose `schedule` is this schedule (`schedules.linked`). **Unlink** removes the checked ones from the list. Empty: "No transactions are linked to this schedule." If loading fails: "The linked transactions couldn't be loaded. Switch tabs to try again." (switching back to Linked reloads it, keeping the pending link and unlink changes), never the empty message.
   - Find matching: Actual's own matching for the dialog's current, unsaved payee, account, amount and date (`schedules.matches`). The host builds the conditions that Actual's schedule rule would have (`payee is`, `account is`, `date isapprox` the config, `amount` with the operator) and turns them into a query with the internal `make-filters-from-conditions` (`03` §3). For a recurring date Actual matches within 2 days of each of the first 100 occurrences from the start date. The list refreshes 300 ms after those fields change. Split lines and rows already linked to any schedule aren't listed; at most 100 rows, the most recent first. **Link to schedule** moves the checked rows to the Linked list. Empty: "No matching transactions." Unavailable handler: "This version of Actual can't search for matching transactions." If the search fails: "The matching transactions couldn't be loaded. Change a field to try again."
   - Changes are applied by Save, in the same job, after the schedule is written: `updateTransaction(id, { schedule })` for each linked row, and `{ schedule: null }` for each unlinked one (settling wrappers, `03` §3). Linking a row counts as paying its occurrence (§2), and it doesn't apply the rule's actions to the row.

**Save** (`schedules.save`) is one write job, checked by the write gate:

1. validate (§1): the dates, the name, the split amounts, a transfer to itself;
2. `createSchedule({ name, posts_transaction, payee, account, amount, amountOp, date })`, or `updateSchedule(id, …)` with the changed fields (`date` only when it changed, §1);
3. `updateRule` on its rule, with the template actions (§1);
4. link and unlink the transactions;
5. from **Move to scheduler…** only: delete the original transaction (§4).

Host errors with a code (`date-before-today`, `no-upcoming`, `end-before-start`, `name-taken`, `transfer-to-self`) show a TaskDialog with the matching message. The dialog stays open. (`split-unbalanced` can't reach the dialog, since the split rules run before Save; it falls under "others".)

| Code | Title | Message |
| --- | --- | --- |
| `name-taken` | "Schedule name already used" | "There is already a schedule named '{name}'. Choose another name, or leave it empty." |
| `no-upcoming` | "No upcoming dates" | "This schedule has no dates from today on. Change when it ends, or when it starts." |
| `end-before-start` | "Invalid end date" | "The end date must be on or after the start date." |
| `date-before-today` | "Invalid date" | "Transactions can't be scheduled before today." |
| `transfer-to-self` | "You can't transfer from an account to itself." | "You will need to change either the source account or the target account for this transfer before continuing." (the register's message, `11` §4.1). It's reached by choosing a transfer and then changing **Account** to that transfer's account. |
| others | | the unexpected-error dialog (`17` §8) |

After a save the dialog closes, the pane refreshes, and the schedule is selected and scrolled into view. The announcement is "Schedule added" or "Schedule saved".

## 4. Creating schedules from register transactions

Both open the Schedule dialog (§3.1) pre-filled from the transaction (`schedules.draftFromTransaction`, a read): its account, payee, amount (operator "is exactly"), category or split lines, and notes without the review tag or check number. Nothing is written until **Add**. After saving, the scheduler pane opens (if hidden) with the new schedule selected (`10` §6.1).

- **Make recurring...**: Repeats on, Monthly, starting on the first occurrence after today (from `get-upcoming-dates` with `start` = the transaction's date; the transaction's date + 1 month without the handler).
- **Move to scheduler...**: Repeats off, on the transaction's date (which must be after today). Saving deletes the original in the same job, without confirmation or undo (`moveFrom` in `schedules.save`). If the transaction is gone by then, the save fails with "That transaction no longer exists." and nothing is written.

## 5. Quick Budget support

`scheduledOutflows(month, categoryId)` (`09` §5.5) counts the occurrences inside the month from `get-upcoming-dates`, starting at the schedule's **`next_date`** (§1). Occurrences already posted aren't counted twice. The reference design counts earlier occurrences in the month too; this is a known minor difference. The handler lists dates from today on (§1); the overdue occurrences between `max(first, next_date)` and today (due but not yet posted, such as a weekly schedule two weeks behind) come from the app's port of Actual's rules (§1). A past month therefore counts only its unposted occurrences. If the handler is unavailable, only `next_date` is counted when it falls in the month. The schedule's category and split lines come from its rule's template actions (§1); a remainder line gets what the fixed lines leave, and an `isbetween` amount counts as `num1`.

## 6. Acceptance criteria

1. Round-trip: each of the 13 frequencies saved, reloaded and shown is unchanged. Occurrence lists equal `schedule/get-upcoming-dates` and Actual web's upcoming dates.
2. A schedule created by the app with `next_date` = yesterday is posted **once** when the budget is next opened (first sync of the day). The posted transaction has the template's category and notes/tags, plus `#needs-review`, and shows as needing review. `next_date` moves to the next occurrence. Re-opening the same day posts nothing more.
3. A custom Actual schedule (e.g. "every 3 weeks") shows its description, and editing its payee keeps its pattern, its unknown config fields, its `next_date` and its actions.
4. **Enter in register now** creates one approved, linked transaction and advances `next_date` by one occurrence. **Skip** advances it without a transaction.
5. A split schedule posts as a split with the template's lines.
6. Entering a transaction in the register that matches a schedule links it, and keeps the user's notes and tags, check number, category and approved state (§2).
7. Every part of the Schedule dialog round-trips through Actual: name, `posts_transaction`, each amount operator (with both "is between" amounts), interval, specific days (a day, Last, the last Friday), each end mode, and the weekend move. The dialog's upcoming dates equal Actual web's for the same schedule.
8. Find matching lists a past transaction within 2 days of an occurrence, with the schedule's payee, account and amount. After Save it is linked (`schedule` set), and Unlink + Save clears the link. Cancel writes nothing.
9. Make recurring… and Move to scheduler… write nothing until Add; Move deletes the original only then.
