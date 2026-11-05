---
spec: ['15']
description: Open the reports, filter them, save filters, and export or print a report.
sidebar_label: Using reports
---

# Using reports

Select **Reports** in the sidebar (**Ctrl+R**). Reports has five tabs:

- **Summary**: your key numbers at a glance.
- **Spending Breakdown**: where your money goes, period by period.
- **Spending Comparison**: this period's spending against the last one.
- **Inflow vs Outflow**: money in and out, month by month.
- **Net Worth**: the balance of your accounts over time.

See [The reports](./the-reports.md) for what each one shows. Reports only read your budget; nothing you do here changes it. They also work offline, from the copy of your budget on this computer.

## Filters

Each report has filters above it:

| Filter | Reports | Default |
| --- | --- | --- |
| **Categories** | all except Net Worth | all categories |
| **Timeframe** | all except Spending Comparison | **Latest 3 Months** |
| **Compare Period** | Spending Comparison | this month |
| **Payees** | all except Net Worth | all payees |
| **Accounts** | all | **Budget Accounts**: every open budget account |

- **Categories**, **Payees** and **Accounts** open a list with a search box, **Select All** and **Select None**. Tick what you want and select **Done**; **Cancel** or **Esc** leaves the filter as it was. Off-budget accounts can be added in **Accounts**. Closed accounts are never included.
- **Timeframe** offers **This Month**, **Latest 3 Months**, **This Year**, **Last Year** and **All Dates**, or a range of whole months chosen with **From:** and **To:**.

### Linked filters

Normally, the filters are shared: change the Categories, Timeframe, Payees or Accounts on one report and the other reports use them too. Options that only make sense for one report, such as Spending Breakdown's grouping, Spending Comparison's period and Net Worth's display, stay with their report.

## Saved filters

Save a report's filters to come back to them later:

1. Set up the filters and options you want.
2. Open **Saved Filters** and choose **Save Current Filters…**.
3. Type a **Name** and select **Save**. Names must be different from the report's other saved filters.

To use a saved filter, open **Saved Filters** and choose **Load** next to it. It applies to the current report only. The menu marks the saved filter that "Matches the current filters". It also has **Replace with Current**, **Rename…** and **Delete…** for each saved filter.

While a saved filter is loaded, that report stops following the shared filters. Select **Use linked filters** to go back to them.

Saved filters are kept on this computer, for each budget. Every time you start Actuality, Reports opens on Summary with the default filters.

## Charts and tables

Every chart has a table with the same numbers beside or below it. With the keyboard, Tab to a chart and press **←** and **→** to move through it; a tooltip shows the values at each point.

Amounts follow Actual's signs: money in is positive and money out is negative. The spending reports show net spending as a positive number, so their bars and lines rise as you spend more. A refund lowers its category's spending.

Periods that haven't happened yet are shown as **—**, not as zero.

## Export and print

Use the report's **Export** menu:

- **CSV…** saves the report's tables, with the filters at the top of the file, for use in a spreadsheet.
- **Print…** opens a print preview of the report with its chart and table, with **Print…** and **Save as PDF…**.

In [privacy mode](../getting-started/finding-your-way-around.md#privacy-mode), amounts are hidden in both.
