---
spec: ['15']
description: What each of the five reports shows.
---

# The reports

## Summary

![Summary dashboard report with multiple widgets](/img/reports/summary-light.png#light)
![Summary dashboard report with multiple widgets](/img/reports/summary-dark.png#dark)

Summary shows nine figures for the timeframe and filters you choose:

| Figure | Shows |
| --- | --- |
| Total Inflow | Money received in income categories. |
| Total Outflow | Money spent in all other categories, less refunds. |
| Net Flow | Total Inflow plus Total Outflow. |
| Avg Monthly Inflow, Avg Monthly Outflow and Avg Monthly Net Flow | Each total divided by the number of months in the timeframe. |
| Budgeted Net Worth | The current balance of all your budget accounts, with its trend over the timeframe. It ignores the filters. |
| Top Spending Category Groups | Your four largest spending groups and everything else, as a pie chart. |
| Money Age | How old your money was when you spent it, with its monthly trend. It ignores the filters. See [Money Age](./money-age.md). |

Months with no transactions, and months still to come, count when working out averages.

## Spending Breakdown

![Spending breakdown report with column graph over a report grid](/img/reports/spending-breakdown-light.png#light)
![Spending breakdown report with column graph over a report grid](/img/reports/spending-breakdown-dark.png#dark)

Spending Breakdown shows your spending as a stacked bar chart, with a table of the same numbers.

- **Group By** sets the bars: **Week**, **Month**, **Quarter** or **Year**. Weeks start on the first day of the week set in [Budget Properties](../budgets/managing-budgets.md#budget-properties).
- **Stack By** splits each bar by **Category Group**, **Payee** or **Account**.

Your five largest items get their own color; the rest are combined as **Other items**. Expand that row in the table to see what's in it. The table also shows each item's **Average** and **Total**.

Select a category group in the chart, its legend or the table to look inside it, category by category. The breadcrumb above the chart returns to all spending.

## Spending Comparison

![Spending comparison report with line graph over a treeview grid](/img/reports/spending-comparison-light.png#light)
![Spending comparison report with line graph over a treeview grid](/img/reports/spending-comparison-dark.png#dark)

Spending Comparison shows how much you've spent so far in a period against the same point in the period before, as two lines that climb as you spend: solid for the current period, dashed for the previous one.

Select **Compare Period** to choose **Week**, **Month**, **Quarter** or **Year**, and which **Period:**. The dialog shows the period it will be **Compared with**. The default is the current month against last month.

When the current period isn't over yet, both lines stop at the same day, so a part-period is never compared with a whole one.

The table lists each category group (expand it for its categories) with **Current**, **Previous**, **Change** and **Change %**, and a total. A positive change means you spent more. "New" means there was no spending in the previous period.

## Inflow vs Outflow

![Inflow vs Outflow report with a treeview grid of inflow accounts vs outflow accounts](/img/reports/inflow-outflow-light.png#light)
![Inflow vs Outflow report with a treeview grid of inflow accounts vs outflow accounts](/img/reports/inflow-outflow-dark.png#dark)

Inflow vs Outflow is a table with a column for each month, plus **Average** and **Total**:

- **Inflow** lists your income by payee under All Income Sources, followed by **Total Inflow**.
- **Outflow** lists Uncategorized and each category group, followed by **Total Outflow**. Expand a group for its categories, or use **Expand All** and **Collapse All**.
- **Net Income** is Total Inflow plus Total Outflow.

Rows with nothing in them are hidden.

## Net Worth

![Net worth report with a line graph above a report grid](/img/reports/net-worth-light.png#light)
![Net worth report with a line graph above a report grid](/img/reports/net-worth-dark.png#dark)

Net Worth shows the balance of your accounts over time. Choose which accounts to include in **Accounts**; off-budget accounts such as investments and loans can be added there. Closed accounts are never included.

- **Single** shows one line for the total.
- **Multiline** shows a line for each account, with each account's ending balance in the legend.

The heading shows the ending balance and how much it changed over the timeframe. The chart has points in the middle and at the end of each month, plus today. The table shows each account's balance and change at the end of each month, and a Net Worth total. Net Worth doesn't predict the future: it shows nothing for dates still to come.
