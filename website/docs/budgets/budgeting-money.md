---
spec: ['09']
description: Enter budgeted amounts, use the calculator and Quick Budget, and hold money for next month.
---

# Budgeting money

## Enter a budgeted amount

1. Select a category's **Budgeted** cell in the month you want.
2. Type the amount. You can type arithmetic too (see [the calculator](#the-calculator)).
3. Press **Enter**, **Tab** or **↓** to save and move to the next category, or **Shift+Tab** or **↑** to save and move to the previous one. Selecting anywhere else also saves.

Press **Esc** to discard what you typed. Category balances, the month header and the totals update as soon as you save.

You can only change budgeted amounts while Actuality is connected to your server. Offline, the cells are read-only.

## The calculator

While you're editing a Budgeted cell (or an amount in the register), type **+**, **\***, **/** or **-** to open a calculator that starts from the current amount. (In an empty cell, **-** just types a minus sign.) For example, select a cell holding 100.00 and type **+25** to make it 125.00.

The calculator works left to right, like a pocket calculator. Press **Enter** or select **OK** to put the result in the cell. In the budget, the result is saved straight away. **Esc** or **Cancel** closes it without changes. **C** clears it and **F** changes the sign.

## Quick Budget for one category

While editing a Budgeted cell, press **F2** or select the arrow at the right of the cell to choose an amount from:

- **Amount budgeted last month**
- **Outflows last month**
- **Average outflows for last 3 months** (or fewer, if you don't have three months of history)
- **Average outflows for last year**
- **Total scheduled outflows this month**: what your scheduled transactions will spend from this category this month.
- **Balance to 0.00**: the amount that brings the category's balance to exactly zero.
- **Show calculator**

## Quick Budget for a whole month

Select the Quick Budget icon on the right of a month's header ("Click for Quick Budget options") to fill in many categories at once:

- **Fill in all empty budget cells with:** last month's budgeted amounts, last month's outflows, average outflows, or total scheduled outflows. These change only categories with nothing budgeted yet.
- **Balance to 0.00** changes every category's budgeted amount so its balance is zero.
- **Fill in all budget cells with: 0.00** clears every budgeted amount in the month.

Hidden categories and Uncategorized Transactions are never changed. Actuality asks before it fills anything in, and the change can't be undone.

## Hold money for next month

Income you receive this month is available to budget this month. If you'd rather budget it next month, for example a paycheck that arrives at the end of the month, hold it:

1. Open the month's Quick Budget menu and choose **Hold for next month…**.
2. Enter the amount to set aside. The dialog shows how much is available to hold.
3. Select **Done**.

The month header shows a **Held for** line, and next month's **Income for** line includes the held money. To release it, choose **Reset hold** from the same menu.

## Where income comes from

Income is any transaction categorized in one of your **income categories**, such as "Income". You choose the category when you enter or import the transaction. Every budget has an income category called Starting Balances, which Actual uses for new accounts' starting balances.

## Month and category notes

Select the note icon on a category, a group, a month header or a single budget cell to write a note. Notes sync with your budget and appear in Actual's web app too. A note icon is shown where a note exists; hover over it to read the note.
