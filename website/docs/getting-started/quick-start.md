---
spec: ['13', '09', '11']
description: A walkthrough of your first session, from adding accounts to budgeting and entering transactions.
---

# Quick start

This walkthrough takes you from a new, empty budget to your first budgeted month. It takes about fifteen minutes. If you haven't connected to your server and created a budget yet, do that first: see [Connect to your server](./connect-to-your-server.md) and [Open or create a budget](./open-or-create-a-budget.md).

## 1. Add your accounts

Add every account you want to track: checking, savings, credit cards, cash.

1. At the bottom of the sidebar, select **Add Account**.
2. Type a **Name**, such as "Checking".
3. Leave **Off budget** unticked for accounts you spend from. Tick it for accounts you only want to track, such as investments or a mortgage. You can't change this later.
4. In **Balance**, type the account's current balance. For a credit card or loan, type what you owe as a negative number, such as `-450.00`.
5. Select **Create Account**.

![Create a New Account dialog, with name, off-budget checkbox, and starting balance](/img/getting-started/create-new-account-light.png#light)
![Create a New Account dialog, with name, off-budget checkbox, and starting balance](/img/getting-started/create-new-account-dark.png#dark)

Actuality opens the new account's register. Its first transaction is the starting balance, with the payee "Starting Balance". For accounts in your budget, it's categorized as income, so the money becomes available to budget.

## 2. Budget your money

1. Select **Budget** in the sidebar (**Ctrl+B**).
2. Look at the current month's header. **Available to Budget** shows the money you can give a job, including your starting balances.
3. Select the **Budgeted** cell next to a category, type an amount and press **Enter**. Actuality moves down to the next category.
4. Keep going until Available to Budget reaches zero. Every dollar now has a job.

![Budget overview with example data](/img/getting-started/budget-light.png#light)
![Budget overview with example data](/img/getting-started/budget-dark.png#dark)

Not sure how much to budget? Press **F2** in a cell for suggestions, such as last month's spending. See [Budgeting money](../budgets/budgeting-money.md).

:::tip Credit card debt

If you carry a balance on a credit card, the card's starting balance lowers Available to Budget. You can budget toward paying it off in the Debt group, or create a category for it. See [Overspending](../budgets/overspending.md) for how Actuality handles categories that go negative.

:::

## 3. Enter a transaction

1. Select an account in the sidebar.
2. Select **Add** in the toolbar, or press **Ctrl+N**. A new row opens at the top of the list.
3. Fill in the **Date**, **Payee** and **Category**, then the amount in **Outflow** (money out) or **Inflow** (money in). Press **Tab** to move between fields.
4. Press **Enter** to choose **Save and add another**, or select **Save** to finish.

![New transaction example with income](/img/getting-started/create-new-transaction-light.png#light)
![New transaction example with income](/img/getting-started/create-new-transaction-dark.png#dark)

Actuality remembers payees. The next time you type the same payee, it fills in the category for you.

## 4. Watch your budget

Go back to **Budget**. The category you spent from now shows the amount in **Outflows**, and its **Balance** is what's left. If you spend more than you budgeted, the balance turns red. See [Overspending](../budgets/overspending.md) for what to do about it.

## Next steps

- Save time by [importing transactions from your bank](../accounts-and-transactions/importing-and-exporting.md).
- Set up [scheduled transactions](../accounts-and-transactions/scheduled-transactions.md) for your paycheck and regular bills.
- [Reconcile](../accounts-and-transactions/reconciling.md) your accounts against your statements.
- See where your money goes with [reports](../reports/overview.md).
