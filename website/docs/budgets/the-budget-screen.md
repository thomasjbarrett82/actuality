---
spec: ['09']
description: How the budget screen is laid out, and what each number in the month header means.
---

# The budget screen

Select **Budget** in the sidebar (**Ctrl+B**). The budget screen is a spreadsheet of your categories down the left and one or more months across. Widen the window to see more months side by side.

![Full budget screen with header, categories, and example data](/img/budgets/budget-light.png#light)
![Full budget screen with header, categories, and example data](/img/budgets/budget-dark.png#dark)

Actuality supports envelope budgeting: each month, you give the money you have a job by budgeting it to categories, and each category's balance is what's left to spend.

## Moving between months

The **timeline** at the top shows the year and its months. Select a month to make it the left-most column, or use the arrows on either side to move one month at a time. With no cell selected, **←** and **→** also move by a month, and **0** jumps back to the current month.

You can view any month from three months before your earliest transaction through eleven months after the current month. Months outside that range are grayed out. The range moves forward by itself as time passes.

## The month header

Each month's header explains how its **Available to Budget** is worked out:

| Line | Meaning |
| --- | --- |
| Not Budgeted in (last month) | Money left unbudgeted last month, which carries forward. It reads **Overbudgeted in** if you budgeted more than you had. |
| Overspent in (last month) | Last month's overspending in categories set to take it from Available to Budget. See [Overspending](./overspending.md). |
| Income for (this month) | Income received this month, plus any income held from last month. Select it to see the transactions. |
| Budgeted in (this month) | The total you budgeted to categories this month. |
| Held for (next month) | Money you set aside for next month. Shown only when you've [held money](./budgeting-money.md#hold-money-for-next-month). |
| = Available to Budget | What's left to give a job. It reads **Overbudgeted** when it's negative. |

In the current month, Available to Budget is green when it's zero or more, and red when it's negative. Aim for zero: every dollar budgeted, and nothing budgeted that you don't have.

Select the Available to Budget amount to collapse the explanation lines in every month, and again to bring them back. Past months are shown in gray.

The two icons on the right of the header add a **note** to the month and open **Quick Budget** options for the month (see [Budgeting money](./budgeting-money.md#quick-budget-for-a-whole-month)).

Below the header, the totals row shows the month's total **Budgeted**, **Outflows** and **Balance**.

## Rows

- **Uncategorized Transactions** appears at the top when any transaction in your budget accounts has no category. These transactions don't affect your budget until you categorize them.
- Each **category group** (master category) shows the totals of its categories. Select the arrow to collapse or expand it.
- Each **category** shows three columns for each month:
  - **Budgeted**: what you've given the category this month. Select it to change it.
  - **Outflows**: what was spent (negative) or refunded (positive) in the category this month. Select it to see the transactions.
  - **Balance**: what's left. A negative balance is shown in red; select it for [overspending settings](./overspending.md).
- **Hidden Categories**, at the bottom, totals the categories you've hidden. See [Categories](./categories.md#hide-and-unhide).

A cell is blank when there's nothing in it. **0.00** in Outflows means there were transactions, and they added up to zero.

## Seeing the transactions behind a number

Select an **Outflows** amount, or the **Income for** line in the header, to see the transactions behind it in a popup. Select a transaction to jump to it in its register, or **Show in Account View** to open the register filtered to all of them.

## The numbers match Actual

Every amount on the budget screen comes from Actual's own budget engine, so Actuality shows exactly what Actual's web app shows for the same month. Actuality's offline copy is updated each time it syncs.
