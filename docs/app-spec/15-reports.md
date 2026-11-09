# 15 — Reports

Reports is a read-only destination with five tabs: **Summary**, **Spending Breakdown**, **Spending Comparison**, **Inflow vs Outflow**, and **Net Worth**. Actual Budget's Custom Reports and Crossover Point are out of scope.

## 1. Page, tabs, and state

- The page has an `h1` "Reports", a tab list in the order above, the applicable filter bar, and the active report. Its main region is labelled by the heading. Navigation to Reports and restoration of the Reports destination focus the heading (`22` §3–4).
- Tabs use the ARIA tabs pattern with manual activation: Left/Right move focus between tabs, Home/End move focus to the first/last tab, and Enter/Space activates the focused tab. Exactly one tab panel is active.
- Summary is selected on every app launch, whether Reports is opened from navigation or restored as `lastScreen`. The selected tab and unsaved filter selections are in-memory view state only.
- Only the active report is queried. Switching tabs uses that report's effective committed filters; it does not start five report queries in parallel.
- The tab content is read-only. Report/table cells and Summary widgets do not navigate to transactions or other reports. Spending Breakdown's in-report category-group drill-down is the only report drill-down (§4.2).

## 2. Filters

### 2.1 Common filters and linked state

Summary, Spending Breakdown, and Inflow vs Outflow show **Categories**, **Timeframe**, **Payees**, and **Accounts**. Spending Comparison shows **Categories**, **Compare Period**, **Payees**, and **Accounts**. Net Worth shows **Timeframe** and **Accounts** only. Each page has its own effective filter set.

- In the ordinary **linked** state, Categories, Timeframe, Payees, and Accounts are shared by the pages that show those filters. Done on any linked page updates the shared values, and every other linked page adopts them. A page with a saved-filter override (§3) is isolated and does not change.
- Breakdown grouping/stacking/drill state, Comparison's period, and Net Worth's display mode are page-specific. Compare Period is independent of the shared Timeframe: changing it does not alter another page's date range, and changing another page's Timeframe does not alter Comparison's selected period. A saved-filter override isolates Comparison's other filters like any other page override; its Compare Period is always page-specific.
- Loading a saved filter applies its complete page-specific snapshot and puts only that page in **saved-filter override** state. It does not change the shared filters or another page. Subsequent filter edits on that page update its override, not the shared filters.
- An override page shows **Use linked filters**. Activating it discards that page's override and adopts the latest shared filters. The control is also available when the override happens to equal the shared values.
- Category, payee, and account pickers use a draft. Done commits; Cancel, Escape, or clicking outside discards it. Search is case-insensitive and clears each time a picker opens. While searching, Select All, Select None, and group checkboxes affect only visible matching items. Category groups toggle their visible children. Empty search results have an explicit message.
- Each picker supports Select All and Select None. Its trigger summarizes all, none, a single selection, or the number selected. Category groups and their child categories are shown hierarchically; Uncategorized is a separate choice. Payees are a flat list, transfer payees included as "Transfer : {account}", with a separate **No Payee** choice for sides without a payee. Accounts are grouped into on-budget and off-budget and list open accounts only. The default Accounts selection (every open on-budget account, including ones created later) reads **Budget Accounts**; Select All picks every open account, off-budget ones included.

### 2.2 Time ranges and options

- The default is **Latest 3 Months**: the current calendar month and the preceding two months. Presets are This Month, Latest 3 Months, This Year, Last Year, and All Dates. This Year includes future months through December. All Dates starts at the month of the earliest available transaction and ends in the current month.
- The Timeframe callout has a title bar, a single horizontal row of preset buttons, a date-range row, and a right-aligned Cancel / Done footer, separated by horizontal rules. The selected preset is indicated with an underline, not a filled pill; use the app's design-system colors rather than color literals (`05` §1.11). At the default window size, all presets fit on one row.
- The date-range row is **From:** followed by separate month and year select controls, then **To:** followed by separate month and year select controls. The controls display the selected month name and year; the two values together select an inclusive calendar month. Do not combine month and year into one control or label the second endpoint **Through:**. Keep each endpoint and its two controls together when the row reflows at constrained widths or zoom.
- Flow-report defaults are all categories, all payees, and all open on-budget accounts. Breakdown defaults to Month / Category Group. Comparison defaults to Month / the current calendar month. Net Worth defaults to Single. Net Worth includes open on-budget accounts by default.
- A custom range selects inclusive calendar months: from the first day of the start month through the last day of the end month. If the start is later than the end, Done swaps them. Date arithmetic uses Actuality's `YYYY-MM-DD` / `YYYY-MM` calendar-date model and has no time-zone conversion (`04` §1).
- Periods are clipped to the selected date range. Weekly grouping starts on the budget's configured first day of week (`04` §3); month, quarter, and year periods use calendar boundaries.
- A transaction side dated after today has not happened yet: it is unobserved, so flow reports and Money Age leave it out even inside a period that has started. Totals then agree however the range is grouped (otherwise a future-dated side would count in the current quarter but not in its later months).
- Flow reports show unobserved future periods as unavailable (—), not as observed zero activity. Future periods contribute zero to range totals and average numerators but remain in monthly-average denominators. Net Worth does not project future transactions; unobserved future points are unavailable. Money Age has no value for a month with no eligible spending (§5).
- Users may explicitly select open off-budget accounts in the Accounts filter for reports that show transaction flows and for Net Worth. Closed accounts are always excluded from ordinary report transactions and Net Worth.
- The Net Worth report has no Categories or Payees filter. Summary's Budgeted Net Worth and Money Age ignore all report filters as defined in §4.1 and §5.

## 3. Saved filters

- Saved filters are grouped by report page. Loading one applies only on the current page; it never changes the active tab or another page's filters.
- A saved definition contains a user name, the page's common filters, and that page's report options: Breakdown grouping/stacking/drill state, Comparison's selected period unit and calendar period, or Net Worth display options. Net Worth definitions omit Categories and Payees.
- The saved-filter menu identifies an exact match to the current page's effective selections. Names are unique case-insensitively within a page. Users can save, rename/replace, load, or delete a definition; deleting requires confirmation. Save is disabled for an empty name or a duplicate.
- A definition is a snapshot, not a live link. Editing an applied definition requires an explicit replace action. The menu shows which saved definition, if any, exactly matches current selections.
- Saved definitions persist per budget and device in the existing settings store (`19` §2). The selected report, shared filters, drafts, and page override state reset each app launch.

## 4. Reports

All amounts are integer minor units, always scaled by 100. Reports use the budget's currency, number, and date format through the shared formatters (`04` §1, `07` §4.2). No report calculation uses floating-point money.

Every rendered monetary value in a report includes the budget's currency symbol whenever one is defined. This applies to Summary widgets and figures in report tables, chart axes and marks, tooltips, and accessible names or descriptions; printed reports follow the same rule. Amounts go through the shared money display formatter, which honors the budget's symbol position and spacing preferences, its number format and its fraction setting. Negative amounts keep the leading minus before the formatted amount. No monetary number is shown bare when a currency symbol is available. If no symbol is defined, the shared formatter's no-symbol behavior applies. Privacy mode masks the whole monetary value instead (`06` §7). CSV remains normalized numeric data, not a rendered money display (`§7`).

### 4.1 Summary

Summary shows a responsive set of nine values/charts:

1. Total Inflow: the signed sum of eligible income-category transaction sides over the selected range and common filters.
2. Total Outflow: the signed sum of eligible non-income-category transaction sides over the selected range and common filters. Ordinary outflows are negative; positive refunds or credits remain positive and reduce net outflow.
3. Net Flow: Total Inflow plus Total Outflow.
4. Average Monthly Inflow.
5. Average Monthly Outflow.
6. Average Monthly Net Flow.
7. Budgeted Net Worth: current balances of all on-budget accounts, independent of filters, with a selected-range balance trend.
8. Top Spending Category Groups: the four largest groups and Other, including Uncategorized, as a share of eligible spending for the range and common filters.
9. Money Age: the latest available monthly Money Age value and a monthly trend for the selected range, independent of filters (§5).

All displayed monetary values retain Actual's signed convention: positive inflows/credits and negative outflows. The three monthly averages divide their signed range totals by the number of calendar months intersecting the selected range, inclusive. Months without transactions and future months count in the denominator; future months have no displayed period value and contribute zero to the numerator. The Net Worth trend is a balance measure, not a flow total. The pie's Other includes every group below the top four and Uncategorized. Summary widgets have no transaction drill-through.

All Summary widgets are centered horizontally within their cards (titles, values, notes, the pie and its legend). Sparklines (Budgeted Net Worth, Money Age) span the widget's full width. Those two widgets always show their data as a table beneath the sparkline; there is no “Show data” toggle. In the single-value widgets (items 1–6) the title sits at the top of the card, the timeframe at the bottom, and the amount is centered vertically in the card. In the three widgets with a graph (items 7–9) the title and its figures sit at the top, the data table (the pie's legend for Top Spending Category Groups) at the bottom, and the graph is centered vertically between them.

The Summary widgets sit on a grid of square cells. The number of columns follows the width of the app window (more columns in a wider window, fewer in a narrower one), and every cell stays square at any column count. Single-value widgets (items 1–6) occupy one square. Widgets that show both a graph and a table (Budgeted Net Worth, Top Spending Category Groups, and Money Age; items 7–9) occupy two squares stacked vertically (one cell wide, two cells tall). Widgets never stretch to a non-square footprint, and their content scrolls or clips inside the card rather than resizing the cell. A card whose content overflows is a tab stop while it does, so the keyboard can scroll it (`22` §7); a card whose content fits stays out of the tab order.

### 4.2 Spending Breakdown

- The page shows a stacked-period chart, a legend, and a table with the same data. **Group By** is Week, Month, Quarter, or Year. **Stack By** is Category Group, Payee, or Account.
- Period, Average, and Total values are signed sums of eligible transaction sides, shown in the spending presentation (§6): net spending is positive, so bars rise as spending grows. Positive amounts in non-income categories (such as refunds) still reduce that category's net spending; they are not dropped or reclassified as income, and a period whose refunds exceed its spending shows a negative value below the zero line.
- The five largest selected stack items over the full range receive individual series; all remaining items are one **Other items (N)** series. The Other table row expands to its members. Category group series use stable semantic colors (by the group's place among the spending groups, cycling `--report-series-1`–`4` and `-6`; Uncategorized is always `--report-series-5`); ranked entity series use a stable rank color within the selected report, not draw order. Spending is ranked largest net spending first.
- A category-group segment, legend item, or corresponding row can drill into that group. The breadcrumb returns to all spending. The drill state filters the selected group when Stack By changes. Uncategorized is not drillable. Table cells are not links.
- The table has one row per stack item and one column per selected period, plus Average and Total. Future periods display as unavailable (—); they contribute zero to the numerator but are included in the Average denominator. Averages divide by every selected period.

### 4.3 Spending Comparison

- The page's **Compare Period** control opens a draft dialog titled **Compare Period**. It has a segmented row of **Week**, **Month**, **Quarter**, and **Year** choices; a **Period:** select showing a calendar period at the chosen granularity; a line reading **Compared with the previous period:** followed by the immediately preceding period; and a Cancel / Done footer. The selected unit is visibly distinguished. The default is **Month** and the current calendar month, displayed with its month and year (for example, **This Month (Oct 2026)**); the comparison line names the previous calendar month (for example, **Sep 2026**). The generic Timeframe presets and From / To date controls aren't used here.
- Changing the unit or selected period updates the comparison preview in the draft. Cancel discards the draft; Done commits it. The filter is independent of the shared Timeframe and does not accept custom date ranges. Week periods follow the budget's configured first day of week (`04` §3); months, quarters, and years follow calendar boundaries. The selected period is compared with the immediately preceding period of the same unit.
- The chart plots cumulative net spending for current and previous periods in the spending presentation (§6): outflows raise the line and refunds/credits lower it, so the line climbs as spending accumulates. Unobserved future dates aren't plotted as zero activity. If the current period is in progress, both series stop at the same elapsed calendar day, so a partial current period is never compared with a complete previous one. The current series is solid and the previous series dashed.
- The table lists category groups and expandable categories, with Current, Previous, Change (`Current - Previous`), and Change % (`100 × Change / abs(Previous)`, formatted as a percentage), all in the spending presentation. If Previous is zero and Current is nonzero, Change % is "New"; if both are zero it is zero. A positive Change or Change % means spending increased; a negative one means it decreased. A Total Spending row ends the table.

### 4.4 Inflow vs Outflow

The page shows an expandable table with each month in range, Average, and Total:

- **Inflow** shows income payees under All Income Sources and transfer inflows under their assigned categories, followed by Total Inflow.
- **Outflow** has Uncategorized and category groups. A collapsed group shows its total; an expanded group shows its categories and group total, including transfer outflows under their assigned categories, followed by Total Outflow.
- Transaction-side amounts and all totals retain Actual's signed convention. **Total Inflow** is the signed sum of income-category rows; **Total Outflow** is the signed sum of non-income-category rows. Positive amounts in non-income categories remain positive credits/refunds and reduce net outflow; they are not reclassified as income. **Net Income** is Total Inflow plus Total Outflow.
- Groups start collapsed. Expand All and Collapse All are available where groups exist. Rows with no data are hidden; section totals remain, and an empty section shows an explicit message.
- Future months display as unavailable (—), not zero activity. Averages divide by all calendar months in the selected range, including months with no transactions and future months; future months contribute zero to the numerator and remain in the denominator.

### 4.5 Net Worth

- The page shows Timeframe and Accounts filters, plus **Single / Multiline**. Categories and Payees are not shown. Single is the default. The Accounts selection alone decides which open accounts, on- or off-budget, are included, regardless of their balances.
- Single shows the aggregate balance of included accounts. Multiline shows one series per included account and a legend with its ending balance. Each series and the aggregate have a table equivalent.
- Closed accounts are excluded. Selected accounts are never excluded because of their balances.
- The report heading shows the ending balance and change since the range start (the balance at the end of the day before it, or today's balance when that day has not yet come, so a range starting in the future shows no change rather than counting future-dated transactions; Summary's Budgeted Net Worth starts the same way). The chart provides mid-month (the 15th) and month-end historical points, clipped to the range, plus a point for today when today is inside the range and not already one of them, so the chart ends at the ending balance the heading and legend show (without it, a balance that first appears after the last past point, such as a loan opened this month, would plot as zero); the full point list is available as a table beside the chart. An account's balance at a point is derived from its opening balance and transaction history; future points have no projected value.
- The table shows each account's month-end balance and change and a Net Worth total row. No selected open account is excluded, so the table has no excluded-account rows or reasons.
- The zero line is at the bottom when all plotted values are nonnegative, at the top when all are nonpositive, and centered on a symmetric scale when positive and negative values are mixed.

## 5. Money Age

Money Age is the average calendar-day age of **known-age cents when spent**, allocated FIFO. It does not estimate the age of funds still held in the budget.

- Money Age is Actuality's custom metric, not directly comparable to similarly named measures in other budgeting apps. A localized, accessible explanation is shown next to the metric: “Money Age estimates the calendar-day age of known-age money when spent. It uses FIFO funding across available history, counts card purchases on their purchase date, and shows what share of spending had known-age funding. Its method differs from other budgeting apps' age-of-money measures.”
- The tracked pool consists of open on-budget accounts only. Category, payee, and account report filters do not change this pool.
- Any positive non-transfer transaction side in an account in the pool creates a known-age funding bucket for its positive normalized amount, dated on its transaction date. This includes income-category inflows and positive credits/refunds in non-income categories. Split lines are processed individually; their parent amount isn't counted. Starting Balance transactions are unknown-age opening funds, not dated funding buckets. For transfers, only an inbound transfer from outside the pool creates a dated bucket; transfers within the pool do not change buckets.
- Positive opening balances are unknown-age funds; they aren't given the age of the budget's first recorded day. Unknown-age funds are consumed before known-age FIFO buckets. Negative opening balances are not funding and do not offset positive balances in other pool accounts.
- Spending counts when it occurs, credit-card purchases included. Card payments and transfers within the measured pool aren't spending, so they aren't double-counted. A transfer into the pool from outside it enters as known-age funding dated on the transfer date.
- Eligible spending is a negative non-transfer, non-Starting-Balance transaction side in a non-income category. Unknown-age funds are consumed before known-age buckets; only the known-age cents matched to eligible spending contribute to the age average and its coverage denominator. Negative income-category sides and other non-spending pool exits reduce available funds but do not count as spending.
- Transfers and other non-spending outflows that leave the pool consume unknown-age funds first, then reduce the oldest known-age buckets FIFO. Negative income-category transaction sides are also non-spending outflows and reduce the pool in this order. These outflows do not count as spending in the metric.
- Each eligible outflow's cents are allocated oldest-first, and `matched cents × calendar-day age` is added to the month's age-days total. The monthly displayed value is `age-days total / known-age cents matched`, rounded to the nearest whole day only for display. Cents and the weighted numerator stay integer-valued.
- Coverage is `known-age cents matched / eligible spending cents`. A month with zero eligible spending has no value. A month with spending but zero known-age matched cents shows no average and 0% coverage. When coverage is below 100%, the average is labelled **Partial** and the coverage is shown, so the metric never implies that known-age funding represents all spending.
- Buckets are built from all available prior history, not just the visible range. The selected range controls the monthly points shown. Same-day positive sides are processed before negative sides; within each class, transactions are ordered by transaction ID ascending and split lines by their line order.

## 6. Transaction and account semantics

- Split lines count once, and the split parent amount is never added. Each transaction side is evaluated independently against its category, payee, and account filters.
- Each transaction side is normalized to Actual's signed integer-cent convention at the host boundary: positive is an inflow/credit, negative is an outflow/debit. No side's sign is flipped, and no absolute value taken, to classify or display it; the spending presentation below negates signed sums for display only. Category determines its report section: income-category sides belong to Inflow, and non-income sides (including Uncategorized) belong to Outflow. Consequently, a positive amount in a non-income category is a refund/credit that stays positive in that category and reduces its net outflow; a negative amount in an income category stays negative and reduces net inflow. For Money Age, positive sides in either section create dated funding buckets; negative income sides reduce the pool without counting as spending (§5). All section, category, period, and report totals are signed sums of their included sides. Net Flow and Net Income are the sum of signed Inflow and Outflow totals. All Starting Balance transactions, whether positive, zero, or negative, are left out of ordinary inflow and outflow totals. In Money Age, positive opening balances are unknown-age funds (§5).
- Transfers may appear as an outflow on the source side and an inflow on the destination side in ordinary flow reports. A side is included only when its account is selected and eligible; transfer sides are never netted together. Category filters apply to each side independently, using that side's category; if only one side matches, only that side is included. In Inflow vs Outflow, each side shows under its corresponding Inflow or Outflow section and category, using Uncategorized when the side has no category. Money Age uses its separate rules (§5).
- Off-budget transaction sides are included only when an applicable Accounts selection explicitly includes those accounts. Closed-account sides are always excluded. Net Worth applies its options as defined in §4.5.
- All totals, comparisons, averages, and series preserve these signed integer-cent amounts and are consistent across reports for the same filters and range. Change is current minus previous; percentage change is `100 × Change / abs(Previous)`, formatted as a percentage.
- **Spending presentation** (Spending Breakdown and Spending Comparison only, §9 item 8). These two reports show only Outflow-section (non-income) sides and present them as spending: every displayed amount is the negation of its signed sum. Calculations still sum the signed sides (`displayed = -(signed sum)`, applied once to each sum, never to individual sides with absolute value), so net spending is positive and a net refund/credit is negative. Change and Change % are computed on the displayed values. Chart marks, axes, tables, tooltips, legends, accessible descriptions, and CSV all use the displayed values; a negative displayed value keeps its minus sign but is not shown in the negative-money color, because it means net refunds, not a deficit. Summary, Inflow vs Outflow, and Net Worth keep Actual's signed convention.

## 7. Data, states, and export

- Reports are read-only and use Actual data through strict, zod-validated host RPC in the serial queue (`03` §3, §8). The host returns report-ready aggregate rows/series, never the raw transaction ledger. A single report request gathers its inputs in one serialized read job.
- Vue Query keys include report kind, effective committed filters, and report-specific options. Drafts are not query inputs. Only the active report is requested; cached results may be shown while refreshing.
- Reports work offline from the Actual API's local cached data when available. They remain read-only. If no usable cached result exists, the report shows the normal error state and Retry action, never fabricated or success-shaped empty data. Loading, error, and empty states are explicit and announced (`22` §4.5). A report with no matching data has a deliberate empty state, not a blank page.
- Each chart has an adjacent table with the same values. Tooltips supplement, never replace, the table. CSV exports the active report's normalized table data, current filters, and options. Export choices are **CSV** and **Print** only. Excel and PDF export formats are out of scope; printing may use the operating system's print-to-PDF destination.
- When privacy mode is on, CSV exports mask monetary values the same way the visible report does. Print follows privacy mode and the Light/Light CVD print palette (`05` §1.9, §1.11). Neither path may bypass the existing main/preload shell boundary (`16` §2–3).

## 8. Accessibility, visual design, and strings

- Charts expose a concise accessible name and description. The adjacent table is the complete non-visual representation of plotted data. Series have a label and a non-color cue (for example line style, marker, or table swatch). Color is never the only distinction.
- Tab, filter, saved-filter, option, legend, and table controls are keyboard-operable. Popovers and dialogs follow `17` and `22` focus, dismissal, and return rules. Async loading, empty, error, and export outcomes are announced. All content remains legible at 200% zoom.
- Privacy mode masks monetary values in cards, tables, chart marks/axes, tooltips, legends, accessible names/descriptions, printed output, and CSV exports (§7).
- Report semantic colors and chart-series tokens have Light, Dark, Light CVD, and Dark CVD values. Reports use the tokens in `05` §1.11, not color literals. Text and meaningful chart marks meet `05` §1.10 contrast requirements in every palette.
- Every visible string, including tab/axis/legend/tooltip names, filter selections, saved-filter dialogs, loading/error/empty states, partial Money Age coverage, its method explanation, unavailable future periods, and export/print statuses, is localized through `20`. Currency, number, and date formatting use the budget's Actual preferences.

## 9. Report semantics

These rules are normative and are reflected in the sections above:

1. **Net Worth:** Single is the default, and closed accounts are excluded. The Accounts filter alone decides which open on- and off-budget accounts are included, regardless of their balances.
2. **Money Age:** it measures open on-budget accounts only, regardless of report filters. Positive normalized non-transfer transaction sides in any category create known-age buckets dated on the transaction date; split lines are processed individually, and Starting Balance transactions remain unknown-age funds. An inbound transfer from outside the pool creates a dated bucket; transfers within the pool do not affect buckets. Unknown-age opening funds are consumed before known-age FIFO buckets; negative opening balances do not fund or offset the pool. Transfers and other non-spending outflows leaving the pool, including negative income-category sides, consume unknown-age funds first, then known-age buckets FIFO, without counting as spending. Same-day transactions are ordered by transaction ID ascending after processing positive sides before negative sides; split lines follow their transaction's line order.
3. **Ordinary totals:** positive, zero, and negative Starting Balance transactions are excluded from both inflow and outflow totals. Opening balances are left out of period flow totals but keep their unknown-age treatment in Money Age.
4. **Transfers:** category filters apply to each side independently. Only the side that matches is included, and each side shows under its corresponding Inflow or Outflow category, using Uncategorized when it has no category.
5. **CSV privacy:** CSV exports mask monetary values whenever privacy mode is enabled, matching the visible report's masking behavior.
6. **Money Age terminology:** it is presented as Actuality's custom metric, with an explanation of its FIFO, purchase-date, and known-funding-coverage method; nothing implies that it is directly comparable with similarly named measures in other budgeting apps.
7. **Charts:** charts are Actuality's own SVG components; there is no chart library. They draw with the report tokens directly, keep their marks in the DOM for the accessible name, description and keyboard tooltip, mask amounts in privacy mode like any other text, print as the same SVG in the Light or Light CVD colors, and add no dependency.
8. **Report signs:** reports keep the register's sign convention (positive inflows and credits, negative outflows), with one exception: Spending Breakdown and Spending Comparison use the spending presentation (§6), showing net spending as positive so their bars and lines rise as spending grows. The exception is display-only: calculations stay signed sums, refunds still reduce spending, and Summary, Inflow vs Outflow, and Net Worth are unchanged.
