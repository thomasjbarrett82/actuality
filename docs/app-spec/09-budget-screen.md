# 09 — Budget Screen

A spreadsheet-like view for envelope budgets: a fixed **category column** on the left and one or more **month columns** to its right, all sharing one vertical scroll position.

## 1. Layout (envelope mode)

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│          [◀] [ 2026 | J  F  M  A  M  J  J  A  S  O  N  D ] [▶]          (timeline)   │ ← top, --row-h tall
├───────────────────────┬┬──────────────────────────┬──────────────────────────┬──┬─────┤
│ Categories [+]  ⊞ ⊟   ││  MONTH HEADER (Jan 2026) │  MONTH HEADER (Feb 2026) │  │ ▲   │
│                       ││  … = $1,234.00           │  ...                     │  │  s  │
│                       ││  Available to Budget     │                          │  │  c  │
│                       ││ ── totals row (Budgeted / Outflows / Balance) ──────│  │  r  │
├───────────────────────┤├──────────────────────────┼──────────────────────────┤  │  o  │
│ Uncategorized Trans.  ││            -45.00   -45.00                          │  │  l  │
│ ▼ Monthly Bills  ✎ [+]││ 1,500.00  -1,450.00  50.00 (master row, bold)       │  │  l  │
│     Rent/Mortgage   ✎ ││ [1,000.00]  -1,000.00   0.00                        │  │     │
│     Phone             ││ [   60.00]    -72.31  (-12.31)→                     │  │     │
│ ▶ Everyday Expenses   ││ ...                                                 │  │ ▼   │
│ Hidden Categories [Unhide]                                                   │  │     │
└───────────────────────┴┴─────────────────────────────────────────────────────┴──┴─────┘
                        ↑ resize grabber
```

| Element | Size / position |
| --- | --- |
| Screen padding | `--space-3` on every side |
| Timeline | at the top, `--row-h` tall; its months line up with the month columns |
| Category column | default `--category-col-w`, resizable 14.5–29 rem via a grabber on its right edge; saved per budget/device in rem (`categoryColumnWidth`) on drag end |
| Month column | min `--month-col-w`, gap `--space-3`. Number of visible months = `max(1, floor((availableWidth + gap) / (monthColW + gap)))`, recomputed on resize (ResizeObserver). The visible columns share any extra width. |
| Row height | `--row-h` for every category row |
| Month header | a date box + amount area; the explanation block animates between its content height (expanded) and `--space-1` (collapsed), and the "=" sign between its natural width and 0 (200 ms) |
| Spacer / totals row | `--space-3` / content height |
| Category column header | matches the month header's height, animated 200 ms |
| Scrolling | ONE scroll container. The category column is `position: sticky; left: 0`. Header and totals rows are sticky at the top. The vertical scrollbar is on the right. Wheel scrolls one `--row-h` per notch. PageUp/PageDown scroll four rows. |

Implementation: CSS Grid. Rows are not virtualized (category counts are small). Only the visible month columns are rendered.

**Loading state:** a centered "Budget" illustration until the first `budget.month` queries resolve, then fade (`06` §2).

## 2. Data: Actual engine → header math (D2, X1–X3)

The host method `budget.month(m)` returns a normalized view built from `getBudgetMonth(m)` and `getBudgetMonth(prev(m))`, plus app-computed rows. For the **first month of the range**, `getBudgetMonth(prev(m))` throws (§2 "Months"), so every `prev.*` value is 0 there. Actual's own `fromLastMonth` is 0 in that month too.

```ts
interface BudgetMonthView {
  month: Month;
  type: BudgetType;          // 'envelope'
  notBudgetedPrev: Money;    // prev.toBudget                  line 1 "Not Budgeted in {Prev}" / "Overbudgeted in {Prev}" if < 0
  overspentPrev: Money;      // ≤ 0, Actual lastMonthOverspent  line 2 "Overspent in {Prev}"
  income: Money;             // totalIncome + prev.forNextMonth line 3 "Income for {Mon}" (link)
  incomeReceived: Money;     //   = totalIncome (received this month)
  incomeHeldFromPrev: Money; //   = prev.forNextMonth (received earlier, released this month)
  budgeted: Money;           // ≥ 0 sum of budgeted            line 4 "Budgeted in {Mon}"
  heldForNext: Money;        // ≥ 0 forNextMonth               line 5 (only if ≠ 0) "Held for {Next}"
  toBudget: Money;           // Actual toBudget                "= Available to Budget" / "Overbudgeted"
  otherAdjustments: Money;   // toBudget − the identity's result below; 0 unless it fails ("Other adjustments")
  totals: { budgeted: Money; activity: Money; balance: Money };   // activity: Σ amounts (spending < 0)
  groups: Array<{ id: Id; budgeted: Money; activity: Money; balance: Money;   // expense groups, hidden included
    categories: Array<{ id: Id; budgeted: Money; activity: Money; balance: Money;
                        carryover: boolean; hasTransactions: boolean }> }>;
  incomeGroups: /* same shape */;  // income categories: received only
  uncategorized: { activity: Money; hasTransactions: boolean };   // app-computed (AQL, 04 §6)
  hasRealData: boolean;      // income ≠ 0 || budgeted ≠ 0 || activity ≠ 0
}
```

- **Field mapping and signs** (confirmed against API 26.10.0 / server 26.2.0; `cur` = `getBudgetMonth(m)`, `prev` = `getBudgetMonth(prev(m))`):

  | View field | Source | Raw sign in Actual |
  | --- | --- | --- |
  | `notBudgetedPrev` | `prev.toBudget` | ± |
  | `overspentPrev` | `cur.lastMonthOverspent`, the Σ of last month's negative balances in categories **without** carryover | ≤ 0 |
  | `incomeReceived` | `cur.totalIncome` | ≥ 0 |
  | `incomeHeldFromPrev` | `prev.forNextMonth` | ≥ 0 |
  | `budgeted`, `totals.budgeted` | **−**`cur.totalBudgeted` | `totalBudgeted` is **negative** (= −Σ category `budgeted`) |
  | `heldForNext` | `cur.forNextMonth` (the manual hold) | ≥ 0 |
  | `toBudget` | `cur.toBudget` | ± |
  | `totals.activity` | `cur.totalSpent` (= Σ expense category `spent`; **excludes** uncategorized) | spending < 0 |
  | `totals.balance` | `cur.totalBalance` | ± |
  | group `budgeted / activity / balance` | expense group `budgeted / spent / balance` | budgeted ≥ 0, spent ≤ 0 |
  | category `budgeted / activity / balance / carryover` | expense category `budgeted / spent / balance / carryover` (`carryover` is a boolean) | as above. `balance` already includes carried-over negatives. |

  Income groups and categories in envelope budgets have only `received` (no `budgeted`/`balance`). The other raw fields, `incomeAvailable` (= `totalIncome + fromLastMonth`) and `fromLastMonth` (= `prev.toBudget + prev.forNextMonth`), are not shown but are used by the identity check.
- **Identity check (unit + integration tested):** `toBudget == notBudgetedPrev + overspentPrev + income − budgeted − heldForNext`. The identity holds exactly, including in months with a hold and with carryover categories. One case is untested: Actual's internal hold is "the manual hold, else the automatic hold from income categories with carryover", but `forNextMonth` reports only the manual one. So an automatic hold could make the identity fail. If Actual's numbers don't satisfy it, display Actual's `toBudget` anyway, add an "Other adjustments" line for the difference, and log a warning. The numbers must always equal Actual's.
- `hasTransactions` (for blank-vs-0.00 display): from an AQL count per category for the month. One grouped query per visible month.
- Uncategorized: on-budget, non-transfer (or off-budget transfer) transactions and split children with `category = null` in the month. Its balance = its activity (no carry). Actual doesn't include these in category math, so they don't affect Available to Budget.
- **Months**: `budget.months()` (= `getBudgetMonths()`) returns Actual's budget range, **from (earliest transaction month − 3) through (current month + 11)**.
  - "Earliest transaction" includes **deleted** transactions, so once the range grows backwards it never shrinks. It moves forward by itself as the calendar month changes.
  - `getBudgetMonth` **throws** `APIError` "No budget exists for month: {m}" for any month outside the range. The app MUST NOT request one.
  - `setBudgetAmount` does **not** validate the month, and silently accepts writes outside the range. The host MUST reject budget writes (`budget.setAmount`, `setAmounts`, `setCarryover`, `hold`, `resetHold`) for months outside `budget.months()` with `validation`.
  - The timeline therefore can't navigate outside the range (§3).
- Vue Query keys: `['budgetMonth', m]`, invalidated on `data:changed` and after any budget/transaction write.

## 3. Timeline (month navigator)

- Left/right arrows (`--row-h` tall) move the selected month by one (crossing years).
- Year box (sized to the year) shows the selected year.
- 12 month cells. Labels adapt to the strip width: < 25 rem → "J", < 65 rem → "Jan", else "January". Bold `body` white.
- Cell styles (within the selected year): from the selected month through the last visible month (not past December) → "also visible" background; the current month among them uses "current + selected". If December is in range, draw an end cap at the strip's right edge. Other months use the normal background ("current" for the current month). Their text is `--timeline-no-data-text` if the month is before the first month with data (the range's first month + 3). The backgrounds come from existing tokens, with no new ones: normal `--header-bg-current`, "current" `--accent-blue`, "also visible" and "current + selected" those two mixed with `--atb-future`.
- A selection indicator slides under the selected month (250 ms, ease-out).
- **Range limits:** months outside `budget.months()` are shown grayed out and can't be clicked. The right arrow is disabled once the last visible column is the last month of the range. The left arrow is disabled at the first month. If the window is wide enough to show more columns than there are months left, the extra columns are empty placeholders: the header and cells are drawn blank, with no data request. Deviation from the reference design, which allowed any month.
- Clicking a month makes it the **left-most** visible column. The selection is saved per budget/device (`lastSelectedMonth`, default = current month). On open: restore it; if it's **after** the current month, jump to the current month; if the current month is beyond the last visible column, move forward just enough to show it.

## 4. Category column

### 4.1 Header

- Label **"Categories"** (600 `md` `--text`).
- `[+]` (tooltip "Add new Master Category") → creates a group named "New Master Category" (then "New Master Category 2", 3…) **at the top** (placed with `category-group-move` in the same job, `04` §3), scrolls to the top, and opens the **Add new master category** popover (§6.2) on it. Cancel deletes the new group.
- **Expand all categories** / **Collapse all categories** icon buttons.

### 4.2 Rows (top to bottom)

1. **Uncategorized Transactions**, only while such transactions exist in *any* month: `--uncategorized-bg`, bold italic `--uncategorized-text`, needs-category icon at left. Not clickable or collapsible, no sub-rows. Past-month cells use `--uncategorized-bg-past`.
2. Each **visible, non-income** group in Actual order (excluding the app's hidden groups):
   - **Group row:** disclosure ▼/▶ at left `--space-4`, name after it (600 `body`, underline on hover), background `--budget-master-bg` (past: `--budget-master-bg-past`). On hover: note icon and a small `[+]` ("Add new subcategory").
   - **Category rows:** indented `--space-6`, 400 `body` (underline on hover). The note icon follows the name (visible on hover or when a note exists). Tooltip: "{name}\n\n{note}\n\nClick to rename, hide, or delete this category." Background white, hover `--budget-row-hover` across the whole row (all month columns too).
   - A dotted separator (1 px dash, 2 px gap, `--budget-cell-border`; past months `--budget-dots-past`) under each row.
3. **Hidden Categories** row: `--hidden-row-text` text, no arrow. Its month cells show totals over all hidden categories (and categories of hidden groups). On hover, if any hidden categories exist, an **"Unhide"** link opens the Show Hidden Categories popover (§6.5).

Group expanded/collapsed state is saved per budget/device (`collapsedGroups: Id[]`, `19` §2).

### 4.3 Interactions (all mutating ones require `canEdit`)

| Action | Result |
| --- | --- |
| Click disclosure | Toggle collapse. |
| Click group name | **Edit master category** popover. |
| Click group `[+]` | Expand the group, create category "New Category" (then "New Category 2"…) **at the end of the group**, scroll it into view, open **Add new category**. Actual inserts at the top, so the host moves it in the same job (`04` §3). Cancel deletes it. |
| Click category name | **Edit category** popover. |
| Click note icon | Note popover (§6.3). |
| Drag a category (> 11 px) | Reorder within its group or move to another group. Drop indicator: 2 px `--drag-indicator` line above/below the target row. Dropping on a group header's upper half → end of the *previous* group; lower half → first position in that group. Not allowed into Uncategorized/Hidden. A target group that already has a category with the same name refuses the drop with the TaskDialog (warning, **Ok**) "There is already a category named {Group}: {Category} \n Please rename one of them and try again." → `categories.move(id, groupId, beforeId)`. This uses the internal `category-move` handler (`03` §3), which handles both reordering and changing group. If the internal handler is unavailable, only drops into another group are allowed, landing at an unspecified position. Other drops are refused with the TaskDialog in `03` §3. |
| Drag a group | Reorder groups (above/below by pointer half). Indicator: 2 px `--drag-indicator` border on the group header. Not onto category rows. → `categories.moveGroup(id, beforeId)`, using the internal `category-group-move` (`03` §3). It's disabled if that handler is unavailable. |
| Auto-scroll | While dragging within 200 px of the top or 100 px of the bottom, speed grows with distance. |
| Keyboard | Category and group moves also work with Alt+↑/↓ and the row menu's **Move Up** / **Move Down** / **Move to Group…** (`22` §2.3–2.4). **Move to Group…** opens a dialog titled "Move to Group" with the text "Move '{name}' to:", a radio list of the other visible groups of the same kind, and **Cancel** / **Move**; the move lands at the end of the chosen group, with the same refusals as a drop. |

## 5. Month column

Each month column stacks: **Header**, a `--space-3` spacer, **Totals row**, then the category grid aligned with the category column.

### 5.1 Month header

```text
┌────┬──────────────────────────────────────────┬──┐
│JAN │      1,000.00  Not Budgeted in Dec        │ ✎│  ← month note icon (white)
│2026│      -120.00   Overspent in Dec           │  │
│    │    +3,000.00   Income for Jan  (link)     │ ⚡│  ← Quick Budget button
│    │    -2,500.00   Budgeted in Jan            │  │
│    │      -200.00   Held for Feb   (if ≠ 0)    │  │
│    │  =  $1,180.00                             │  │
│    │       Available to Budget                 │  │
└────┴──────────────────────────────────────────┴──┘
```

- **Date box** (a `--control-h-lg` square): short month name in capitals (700 `xl` white; past `--atb-past`) above the year (700 `sm` `--header-explanation-amount`; past `--atb-past`).
- **Explanation lines** (§2): amounts right-aligned (600 `sm` `--header-explanation-amount`), labels left-aligned (400 `sm` `--header-explanation-label`). Past months both `--atb-past`. Format: no currency symbol. The operator ("+"/"−") is prefixed only when the value is ≥ 0; negative values show their own "-". Line 1's label becomes "Overbudgeted in {Prev}" when `notBudgetedPrev < 0`. Line 5 is shown only when `heldForNext ≠ 0`. The block grows by one line for it.
- **Income line** is a link: hover underlines amount and label. Click → transactions popover titled "Income for {Month}" (long month name) with "**{income}** total income was categorized as "Income for {Month}".
  - {incomeHeldFromPrev} was received in {PrevMonth}
  - {incomeReceived} was received in {Month}" (or "No transactions have been categorized as "Income for {Month}"" when empty). The grid lists this month's income-category transactions plus a summary row "Held from {PrevMonth}" when non-zero. Tooltip "Click to see income transactions".
- **"= amount"** (with symbol): 700 `2xl`. Color: current month → `--atb-positive` (≥ 0) / `--atb-negative` (< 0); next month → `--atb-negative` if negative, else white; later months → white; past months → `--atb-past`. The `=` sign is 700 `xl` `--header-equals-sign` (past `--atb-past`).
- **Summary label**: "Available to Budget", or **"Overbudgeted"** when negative (600 `body` white; past `--atb-past`). Clicking the amount or the label toggles the header between **expanded** and **collapsed** for all months. Tooltip "Click to collapse details" / "Click to see further details". Saved as `budgetHeaderExpanded` (`19` §1). Animated 200 ms.
- **Background**: a vertical gradient, `--header-bg-current` → `--header-bg-current-end` for the current and future months, `--header-bg-past` → `--header-bg-past-end` for past months.
- **Right strip** (one `--hit-min` icon button wide): month note icon (white; click → note popover for the month) and the **Quick Budget** icon (50% alpha, 100% on hover; tooltip "Click for Quick Budget options") → menu §5.5.

### 5.2 Totals row

Three right-aligned stacks (34/33/33%): title (600 `body` `--text-muted`) above value (600 `body` `--text-strong`; past both `--text-muted`).

| Title | Value |
| --- | --- |
| "Budgeted" | `totals.budgeted` (with symbol) |
| "Outflows" | `totals.activity` (with symbol; spending shows negative) — a link: transactions popover "You spent {amount} in {count} transactions:" for every on-budget categorized transaction in the month |
| "Balance" | `totals.balance` (with symbol) |

### 5.3 Group row (per month)

600 `body`: budgeted total (no symbol; blank on Uncategorized), activity total (signed, "+" prefix when positive, no prefix on 0; click → popover over all its categories, "You spent {amount} in {count} transactions:" / "…in {count} transaction:"; on Uncategorized "You spent {amount} in {count} transactions with no category assigned:"), balance total (negative → `--money-negative`, no pill; 0 → 50% opacity). Background per §4.2.

### 5.4 Category row (per month) — the budget cell

Three cells: **Budgeted** (34% plus `--space-1`, bordered box), **Outflows** (33%), **Balance** (33%).

| Cell | Display |
| --- | --- |
| Budgeted | Box with 1 px `--budget-cell-border` border (past `--budget-cell-border-past`). Right and bottom borders always; top border only on the first category row of a group. While a cell is focused, the row above drops its bottom border so the focused box is fully outlined. Amount with thousands separators, **blank when 0**. 400 `body`. I-beam cursor. A cell note (if any) shows a small note icon at the box's left edge. |
| Outflows | `activity` signed, no symbol: spending "-72.31", refunds "+12.00". **Blank** when 0 and no transactions. Shows "0.00" if transactions net to zero. With transactions: hand cursor, underline on hover, tooltip "Click to see transactions". |
| Balance | No symbol. Blank when 0 and no transactions. Positive `--text`; zero `--text` at 50%; negative `--money-negative` inside a pill (`--radius`, `--money-negative-pill`). If negative **and** `carryover` is on, draw a small `--overspend-arrow` right-arrow after the amount. Clicking a negative balance → **Overspending Settings** (§6.4). Tooltip "Click here to determine how to handle overspending for this category." |
| Dividers | dotted vertical before Balance, dotted bottom border (colors per §4.2). |

#### Editing the Budgeted cell (requires `canEdit`; otherwise the cell is read-only and shows the offline tooltip)

1. Click → the cell becomes a right-aligned text input with transparent background and all text selected. Allowed characters: digits, `., + - * /`, and the locale decimal separator (the numpad decimal key inserts the locale separator). A small **dropdown arrow** appears at the box's right edge (tooltip "Click for Quick Budget options and calculator").
2. Keys:

   | Key | Action |
   | --- | --- |
   | Enter / Tab / ↓ | Commit, move to the next visible category cell in the same month (wraps to the top; skips collapsed groups) |
   | Shift+Tab / ↑ | Commit, move to the previous visible cell (wraps) |
   | Esc | Discard the typed text: the stored value is shown again and the editor closes. If the text was unchanged, focus also leaves the cell. |
   | F2 | Per-cell Quick Budget list |
   | `+` `*` `/` | Calculator pre-loaded with the current value and that operator |
   | `-` | If the current value ≠ 0, calculator with `-`; otherwise type a minus sign |

3. Clicking outside commits. Commit parses the text as currency. Invalid text reverts. Unchanged → no write. Otherwise `budget.setAmount(month, categoryId, amount)`. The UI updates optimistically and is rolled back on error.
   **Calculator OK commits immediately.** When the calculator's Enter/OK puts a result into the cell, that value is committed at once (same rules as above: unchanged → no write, otherwise `budget.setAmount`, optimistic), so the row's Balance, the month header and the totals update right then. They don't wait for the editor to lose focus. The editor stays open on the committed value, with the text selected.
4. The focused row is highlighted (`--budget-row-hover`) across all columns.

#### Per-cell Quick Budget list

A popup list (as wide as its longest label plus the widest amount, at least 16 rem; `--row-h` rows; 1 px `--tooltip-border` border, 50% shadow), right-aligned under the cell (above it if there's no room). Items (from `budget.quickBudgetStats`, §5.5):

1. "Amount budgeted last month:" → prev budgeted
2. "Outflows last month: " → prev outflows
3. "Average outflows for last {min(3,h12)} months: " (only if `h12 > 1`, the same rule as the month menu in §5.5)
4. "Average outflows for last year:" (if `h12 == 12`) or "Average outflows for last year (only {h12} months available): " (if `3 < h12 < 12`)
5. "Total scheduled outflows this month: "
6. "Balance to 0.00: " → `budgeted − balance`
7. "Show calculator" (calculator icon)

Click or Enter on the highlighted row sets the budgeted amount. Esc or an outside click closes it. Typing `+ * /` opens the calculator with that operator.

#### Calculator popup (`<Calculator>`, shared with the register)

Sized by its buttons (about 15 × 17 rem), `--panel-bg`, 1 px solid `--tooltip-border` border:

```text
[ display                    ]
[ C ] [+/-] [<--] [ / ]
[ 7 ] [ 8 ] [ 9 ] [ X ]
[ 4 ] [ 5 ] [ 6 ] [ - ]
[ 1 ] [ 2 ] [ 3 ] [ + ]
[ 0 ] [ . ] [ = ]
            [ OK ] [ Cancel ]
```

The `.` key shows the locale decimal separator. Keyboard: digits, `.`/`,`/locale decimal, `+ - * /`, `=`, Backspace (remove last char), `C` clear, `F` negate, Enter = calculate and **OK** (writes the result into the cell, **commits it immediately** via `budget.setAmount` so Balance and the totals update at once, and reopens the cell editor on the new value), Esc = cancel. Positioned right-aligned under the cell, or above it if it doesn't fit. 0/0 = 0. A non-finite result shows "Error". Results are rounded to minor units (half away from zero). The display holds at most 30 characters. Evaluation is left-to-right (calculator semantics, not operator precedence), done on scaled integers/decimal strings, never floats.

### 5.5 Quick Budget (month level)

Menu (native context menu via `shell.showContextMenu`) under the header icon:

```text
Fill in all empty budget cells with:            (disabled heading)
   Budget values used last month
   Outflows last month
   Average outflows for the last {min(3,h12)} months   (only if h12 > 1)
   Average outflows for the last year                (only if h12 > 3; + " (only {h12} months available)" when h12 ≠ 12)
   Total scheduled outflows this month
   Balance to 0.00
Fill in all budget cells with:                  (disabled heading)
   0.00 (Zero all budgeted amounts for this month)
──────────
Hold for next month…                            (X1)
Reset hold                                      (only when heldForNext ≠ 0)
```

Labels are indented three spaces. "0.00" is the locale-formatted zero. All fill items skip Hidden and Uncategorized and income categories. The "fill" items change only categories whose budgeted amount is 0, except "Balance to 0", which replaces each eligible category's current budgeted amount with the amount needed to bring its balance to 0 (including a target of 0). "Zero all" sets every eligible category to 0. All writes for one action run inside `batchBudgetUpdates` (`budget.setAmounts`).

**Math** (`src/shared/quickbudget/`, computed by the host for each `budget.quickBudgetStats` call from `getBudgetMonth` of the history months; nothing is cached between calls):

- `startingMonth(m)`: if `m` ≤ the current calendar month → the month **before** the current month; otherwise the current month.
- `validHistory(maxN, m)`: start from `next(startingMonth(m))`, walk backwards up to `maxN` months, and return the count up to the furthest month whose *previous* month `hasRealData`.
- `averageOutflow(n, cat)`: walk back `n` months from `next(startingMonth(m))`, sum `−activity`, divide by the months walked (min 1), and round to minor units. The budgeted value = that average (≥ 0 for spending).
- `scheduledOutflows(m, cat)`: for every schedule, the occurrences in the month (`schedules.upcomingDates(id, {from: max(first, next_date), to: last})`, using Actual's `get-upcoming-dates` from today on and the app's port of Actual's rules for the overdue ones before today, `12` §1, §5). If the schedule's category is `cat` → Σ outflow × occurrences. A schedule with a positive amount (inflow) is ignored. For split schedules, sum the matching lines' outflows.
- Values: last month's budgeted; last month's outflows (`−prev.activity`); the averages; scheduled; `budgeted − balance` (the target budgeted amount for Balance to 0).

**Confirmation** (TaskDialog, app logo icon, buttons **Cancel** / **Fill in empty budget cells** (default), content "This operation cannot be undone."; the fill runs only on the default button):

| Item | Main instruction |
| --- | --- |
| Budget values used last month | "Fill in empty budget cells with the amounts budgeted in {Mon 'YY}?" |
| Outflows last month | "Fill in empty budget cells with the outflows from {Mon 'YY}?" |
| Averages | "Fill in empty budget cells with the average outflows of {Mon 'YY}?" (history = 1) / "…with average outflows for the last year?" / "…with average outflows for the last {n} months?" |
| Scheduled | "Fill in empty budget cells with the total scheduled outflows for {Mon 'YY}?" (the selected month) |
| Balance to 0 | "Replace all eligible budget amounts to bring their category balances to 0?" — button "Balance to 0.00" |
| Zero all | "Budget 0.00 for *every* category this month?" — content "This will overwrite any existing budgeted amounts for this month, and cannot be undone." — button "Budget 0.00 for every category" |

`{Mon 'YY}` is the previous month (or the selected month for Scheduled).

**Hold for next month…** (callout on the header, `--popover-w-sm`): title "Hold for next month", text "Set aside money from {Month} so it's available to budget in {Next}. Available to hold: {toBudget + heldForNext}.", amount input (default = current `heldForNext` or `max(0, toBudget)`), **Cancel** / **Done**. Done → `budget.hold(month, amount)`, which resets the month's hold and then holds the new amount in one job: Actual's `holdBudgetForNextMonth` only holds out of what To Budget has left, so the old hold must be released first for "Available to hold" to be right. **Reset hold** → `budget.resetHold(month)` (no confirmation).

## 6. Popovers on the Budget screen

All are callouts (`17` §3): a bubble with a tail, a title bar sized to its text (400 `xl` `--text-subtle`), a light gradient body and a right-aligned button row. They close via their buttons, an outside click or Esc. They don't close on roll-out.

### 6.1 Edit / Add category (`--popover-w`)

- Title "Add new category" / "Edit category".
- Text input (600 `md`), pre-filled, all selected, focused on open.
- Links (edit mode only): **Hide this category** (hide icon, `--link` underlined, `sm`), **Delete this category** (delete icon, `--link-danger`, `sm`).
- Buttons **Cancel**, **Done** (default). Enter = Done, Esc = Cancel. Cancel on a *new* category deletes it (an outside click just closes). Tail preference: topLeft, bottomLeft, top, bottom.
- Validation on Done, only if the name changed (TaskDialog "Please choose a different category name" + message + **Close**):
  - empty → "The category must have a name";
  - contains `:` or `` ` `` → "The category cannot contain the following characters: ":" or "`"";
  - duplicate in the group → "The category name has already been used".
- Hide → `categories.update(id, {hidden: true})` (X10).
- Delete → `categories.deleteImpact(id)` then confirmation (app logo icon): main instruction "Permanently delete category '{name}'?". Content: "Money has been budgeted for this category in {n} month(s).\nDeleting this category will result in **permanently** losing these budgeted amounts." (if any month has budgeted ≠ 0) and/or "There are **{n}** transaction(s) totaling **{amt}** currently assigned to this category. After deleting this category, these transactions will be uncategorized, which means they will no longer affect your budget." (if any), then "Are you sure you wish to delete this category?". Buttons **Delete category**, **Cancel** → `categories.delete(id)`, which calls `deleteCategory(id)` with no transfer category. Integration tests confirm that transactions become uncategorized and budgeted amounts are lost, as the dialog specifies.

### 6.2 Edit / Add master category (`--popover-w`)

Same structure. Titles "Add new master category" / "Edit master category". Links "Hide this Master Category (and its sub-categories)", "Delete this Master Category (and its sub-categories)". The name is trimmed. Extra validations:

- equals "Income" → "When specifying income, please use one of your income categories. If you want to differentiate income sources, you can use different payees.";
- reserved names ("Hidden Categories", "Uncategorized Transactions", "Add New Category...") → "You can't use that category name, as it is reserved. Please choose another.";
- duplicate group name → "The category name has already been used".

Hide → group `hidden = true`. Delete confirmation: "Permanently delete master category '{name}' and all of its sub-categories?". Content: "Money has been budgeted for this category's sub-categories in **{n}** month(s). Deleting this category will result in **permanently** losing these budgeted amounts." and/or "There are **{n}** transaction(s) totaling **{amt}** currently assigned to this category's sub-categories. After deleting this master category, these transactions will be uncategorized, which means they will no longer affect your budget." then "Are you sure you wish to delete this master category and all of its sub-categories?". Buttons **Delete master category**, **Cancel**. Deletes the categories first, then the group.

### 6.3 Note popover

- Title = the object's name: category, group, month ("January 2026"), or cell ("{Category} — January 2026").
- Multi-line textarea (about 7.5 rem tall, `--panel-bg`, `body` `--text-subtle`), focused on open.
- Buttons: **Delete Note** link (left, `--link-danger`), **Cancel** (discard), **Done** (primary). An outside click also saves. The text is trimmed. Empty or Delete → clear (`updateNote(id, '')`). Tail preference: topRight, bottomRight, topLeft, bottomLeft.
- The note icon is hidden unless a note exists or the row is hovered. It is 50% alpha until hovered. Tooltip: the note text, or "Click to add a note here".
- Notes exist on groups, categories, months (header), and month×category cells (reserved note, `04` §5.3).
- Actual `#template`/`#goal` lines in category notes are shown and edited as plain text.

### 6.4 Overspending Settings (`--popover-w`) (X2)

- Title "Overspending Settings". Text: "How do you want to handle overspending for this category?"
- Radio 1: "Subtract it from next month's "Available to Budget"" (carryover off)
- Radio 2: "Subtract it from next month's category balance" + red arrow icon (carryover on)
- **Actual's name for this setting.** Radio 2 is what Actual calls **"Rollover overspending"** (its category balance menu), and Radio 1 is Actual with rollover off. Actual's docs use that name, for example the credit card "Carrying Debt" guide, which tells users to set each card's debt category to "Rollover Overspending". In Actuality that means choosing Radio 2 here.
- Buttons **Cancel**, **Done** (green). The current setting is pre-selected. Only Done applies: `budget.setCarryover(month, categoryId, bool)` → `setBudgetCarryover`. Integration tests confirm that Actual applies the value to **this month and every later month that exists**, through `bounds.end` (current month + 12, one month beyond the readable range, `09` §2). It **overwrites** any later month set differently. That matches the reference design's month-to-month inheritance closely enough; there is no "until the next explicit setting". Earlier months are untouched. `setBudgetCarryover` throws for months outside `budget.months()` and for income categories, and the host rejects both first with `validation`.
  - **Months Actual creates later don't inherit carryover.** When the calendar moves the range forward, the new month starts with carryover **off**, so a setting made today would silently end about a year later. That would break the Confined handling. **Carryover extension**, run by the host as a session start task at the session's first transition to `Online` (`03` §6.4, `07` §1):
    1. Read `carryoverSeenEnd` from the synced reserved note `ad:budget` (`04` §5.3): the last `bounds.end` that **any** device running Actuality extended to. `bounds.end` = the last month of `budget.months()` + 1. It's synced rather than per device, so a device opened for the first time after months of use elsewhere still extends the months created in between.
    2. With no stored value (the first open of this budget by Actuality on any device), store the current `bounds.end` and stop.
    3. If `bounds.end` is later than `carryoverSeenEnd`, call `setBudgetCarryover(carryoverSeenEnd, cat, true)` for every expense category whose carryover is **on** in `carryoverSeenEnd`. That month is readable now, and the call writes it (already on) plus every newer month. Do it in one job inside `batchBudgetUpdates`, then store the new `bounds.end` in `ad:budget` in the same job. Only newly created months are touched, so a user's explicit **off** in an existing month is never overridden. Two devices extending at the same time write the same values, so the whole-note last-writer-wins rule (`04` §5.3) is harmless here.
    4. Also run it after the first successful sync of each local day (alongside `12` §2), so a long-running app catches the monthly range change.
  - **Why Actuality works around this instead of following Actual.** Actual's docs say that with "Rollover overspending" on, "For all future months, a negative balance will stay in the category", but in practice the flag only reaches the months that exist when it's set. Actual's maintainers treat this as intended, so it won't be fixed upstream:
    - [actualbudget/actual#8728](https://github.com/actualbudget/actual/issues/8728) ("Rollover overspending keeps randoming getting turned off", closed as not planned, Aug 2026) is this exact symptom in Actual's own app. The maintainer's answer: "Rollover overspending is turned on for 12 months when you enable it in a category." Without the extension, Actuality users would hit the same thing.
    - [actualbudget/actual#6224](https://github.com/actualbudget/actual/issues/6224) ("Toggling overspending rollover only propagates forward", closed as by design, Nov 2025) explains why a month's flag must not be changed afterwards: once rollover is set for a month, "it needs to stay that way or the budget history is lost", because it changes that month's balances and "to budget" numbers. That's why the extension writes only months created since `carryoverSeenEnd` and never rewrites an existing one.

### 6.5 Show Hidden Categories

- Title "Click a category to unhide it".
- For each group with hidden categories (or that is hidden itself): a bold link "{Group}:" (unhides the group and all its hidden categories), then indented (`--space-6`) links for each hidden category (`--link`, underlined, `body`). Thin rules between groups. Height 7.5–23 rem, scrolls.
- If there are more than two items: an **Unhide All** link at the bottom.
- Clicking any link unhides and closes the popover.

### 6.6 Transactions popover (`<TransactionsCallout>`, `--popover-w-lg`)

Opened by clicking an Outflows value (category, group, Uncategorized, totals) or the income line.

- Title: the category/group name (or "Income for {Month}").
- Summary: "You spent {amount} in {count} transactions:" / "You spent {amount} in {count} transaction:" / "You spent {amount} in {count} transactions with no category assigned:" (the same strings as §5.2–5.3).
- Read-only grid (`--row-h` rows, 4–8 rows tall, scrolling beyond): **Date** (4 rem), **Account** (5.75 rem), **Payee** (5.75 rem; split lines show "[Split] {Payee} / Transfer: X"), **Notes** (5.75 rem; split notes + " - " + parent notes), **Amount** (5.75 rem, right). Sorted newest first.
- Clicking a row closes the popover and jumps to that transaction in the register (`10` §9.1).
- Buttons: **Show in Account View** (eye icon; disabled when empty) → the register (the single account if all rows share one, otherwise All Accounts) with a pre-built search (`Category: {Group}: {Name},`, or `Income: {Month YYYY},`) and a date filter covering the transactions' dates. **Close**.
- When a category or group has *no* outflows and the user clicks its Outflows cell (not Hidden/Uncategorized), and `showEmptyOutflowTooltip` is true: the text popover "How to Enter an Outflow": "There are currently no outflows for the category **'{category}'** in {month}.
- To enter an outflow, select one of your accounts and click **Add** in the register toolbar. Make sure to categorize the transaction as **'{category}'** and date it sometime in {month} to have it show up here." with a **Don't show this again** checkbox (saves `showEmptyOutflowTooltip = false` and closes).

## 7. Keyboard & mouse

| Input | Action |
| --- | --- |
| Wheel | scroll (one `--row-h` per notch) |
| PageUp / PageDown | scroll four rows |
| Click Budgeted cell | edit (§5.4) |
| Enter/Tab/↓, Shift+Enter/Shift+Tab/↑ | move to the next / previous Budgeted cell |
| F2 | per-cell Quick Budget |
| `+ - * /` in a cell | calculator |
| ← / → (no cell focused) | previous/next month (convenience) |
| 0 (no cell focused) | the current month becomes the left-most visible column, as clicking it in the timeline (§3) |

## 8. Persistence (per budget, per device; `19` §2)

`lastSelectedMonth`, `categoryColumnWidth` (14.5, in rem), `showEmptyOutflowTooltip` (true), `collapsedGroups` ([]). App-wide: `budgetHeaderExpanded` (true).

## 9. Acceptance criteria (envelope)

1. For a seeded test budget, every number displayed equals the Actual web UI for the same months (e2e compares with values from `getBudgetMonth`).
2. The header identity (§2) holds for every month in the fixture. The "Other adjustments" line never appears with the fixture.
3. Editing a cell, Tab-navigation, Esc semantics, calculator (Enter/OK commits at once, so Balance updates without leaving the cell) and Quick Budget behave as specified, including wrap-around and skipping collapsed groups.
4. Offline: cells are read-only, and popovers' Done buttons are disabled with the offline tooltip.
5. Hide → the category moves to Hidden Categories. Unhide restores it to its group.
