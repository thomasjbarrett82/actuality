---
spec: ['13', '08']
description: Create, rename, close, re-open and delete accounts, and keep them in order.
---

# Accounts

## Budget and off-budget accounts

- **Budget accounts** hold money you spend and budget: checking, savings, credit cards, cash. Their transactions need a category and affect your budget.
- **Off-budget accounts** track things whose value you want to see but don't budget from: investments, a mortgage, a house. Their transactions don't have categories and don't affect your budget.

An account stays on or off budget for its whole life. Choose carefully when you create it.

Accounts have no type: a credit card or loan is simply an account with a negative balance.

## Create an account

1. Select **Add Account** at the bottom of the sidebar.
2. Type a **Name**. It must be different from your other accounts' names and can't contain `` ` ``.
3. Tick **Off budget** if this is a tracking account.
4. Enter the **Balance** the account has today. For money you owe, type a negative number.
5. Select **Create Account**.

Actuality opens the account's register. If the balance isn't zero, Actual adds a transaction for it, dated today, marked cleared, with the payee "Starting Balance". In a budget account, it's categorized as **Starting Balances** income, so the money is available to budget.

## Rename an account or add a note

Open the account's register. Its name is at the top, with two buttons that appear when you hover over or tab to it:

- **Rename**: type the new name and press **Enter**, or **Esc** to cancel.
- **Notes**: write a note about the account, such as its account number or interest rate. The note shows in the sidebar tooltip and in Actual's web app.

The same commands are on the account's right-click menu in the sidebar and in the **Edit** menu.

## Close an account

Close accounts you no longer use. A closed account moves to **Closed Accounts** in the sidebar and keeps its history, which you can still view, but you can't choose it for new transactions or transfers. Reports leave closed accounts out.

Open the account and choose **Close Account** from the **⋯** menu at the top right of the register (or right-click the account in the sidebar). What happens depends on the account:

- **No transactions:** the account is deleted.
- **Transactions and a zero balance:** the account is closed. You can re-open it later.
- **A remaining balance:** choose an account to transfer the balance to in **Transfer to:**. When moving money from a budget account to an off-budget account, also choose a **Category:**.

To re-open a closed account, open it and choose **Re-open Account** from the **⋯** menu.

## Delete an account

An account with transactions can only be deleted with **Force close**, at the bottom of the Close Account dialog. It deletes the account and all its transactions, and can't be undone. If it was a budget account, the money in those transactions disappears from your budget.

## Reorder accounts

Accounts are listed in the order you choose, within their group. Drag an account up or down, or right-click it and choose **Move Up** or **Move Down**. With the keyboard, select the account in the sidebar and press **Alt+↑** or **Alt+↓**.

Accounts can't be dragged between groups: an account's group follows from whether it's on budget and whether it's closed.

## Balances in the sidebar

Each account shows its **working balance**: everything in the account, cleared or not. Hover over an account to see its name, balance and note. Totals are shown for each group, and **All Accounts** shows the total of every account, including off-budget and closed ones.
