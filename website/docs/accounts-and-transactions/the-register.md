---
spec: ['10']
description: The account register's columns, toolbar, sorting, filters and balances.
---

# The register

The register lists an account's transactions. Select an account in the sidebar to open its register, or **All Accounts** for every transaction in every account. **View ▸ Go to Accounts** (**Ctrl+T**) returns to the last account you used.

From top to bottom, the register has:

- the account's name, with **Notes**, **Rename** and the **⋯** menu (single accounts only),
- messages about transactions that need attention,
- the toolbar,
- the list of transactions,
- a footer with the account's balances, the **Scheduled Transactions** button and **Reconcile Account**,
- the [scheduled transactions](./scheduled-transactions.md) pane, when it's open.

![Register screen view with multiple examples and columns visible](/img/accounts/register-light.png#light)
![Register screen view with multiple examples and columns visible](/img/accounts/register-dark.png#dark)

## Columns

| Column | Shows |
| --- | --- |
| Account | The transaction's account. All Accounts only. |
| Date | The transaction date. |
| Check # | The check number. Hidden until you turn it on. |
| Payee | Who the money went to or came from. Transfers show an icon; select it to jump to the other side. |
| ! | An icon for transactions that need attention. Shown only when the account has any. |
| Category | The category, as "Group: Category". Not shown for off-budget accounts. |
| Notes | The memo, with tags shown as colored labels. |
| Outflow / Inflow | Money out and money in. |
| Balance | The running balance after each transaction. Hidden until you turn it on. |
| C | Whether the transaction has cleared your bank. |

Right-click any column header (or press **Shift+F10** on it) to show or hide **Check**, **Cleared**, **Notes** and **Running Balance**. Choose **Apply current settings to all existing accounts** to use the same columns everywhere. Drag the edge of the Account, Check #, Payee, Category or Notes header to resize it. Actuality remembers the columns for each account.

![Column header with column options and current state](/img/accounts/columns-menu-light.png#light)
![Column header with column options and current state](/img/accounts/columns-menu-dark.png#dark)

## Sorting

By default, the newest transactions are at the top. Select a column header to sort by it, and select it again to reverse the order.

To sort by more than one column, **Shift+click** further headers. Each adds a level (up to four), shown by a small number next to the arrow. Shift+click a sorted header again to reverse it, then once more to remove it.

After you edit transactions, press **F5** to sort the list again. Actuality remembers the sort for each account.

## How transactions are marked

| Look | Meaning |
| --- | --- |
| **Bold** | Waiting for you to approve it: imported from your bank, or entered by a schedule. |
| Orange "This needs a category" | A transaction in a budget account without a category. |
| Red category | A transfer between two budget accounts that has a category, which it shouldn't. |

The messages above the toolbar count these, such as "2 transactions need a category". Select **Show** in a message to list just those transactions. For how to fix them, see [Working with transactions](./working-with-transactions.md).

## The toolbar

| Control | What it does |
| --- | --- |
| **Edit Transactions ▾** | The actions menu for the selected transactions. See [Working with transactions](./working-with-transactions.md). |
| **Add** | Starts a [new transaction](./entering-transactions.md). |
| **Transfer** | Starts a new [transfer](./splits-and-transfers.md#transfers) to another account. |
| **Import** | [Imports a file](./importing-and-exporting.md) from your bank into this account. |
| Reconciled filter | Shows or hides transactions you've already reconciled. |
| Date filter | Shows **This Month**, **Latest 3 Months**, **This Year**, **Last Year**, **All Dates**, or the months you choose in **From:** and **Through:**. |
| Search | Finds transactions. See [Searching](./searching.md). |

When the list is filtered, a dark bar above it says how many transactions it shows, with **Clear Search** or **Clear Date Filter** to show everything again.

## The footer

The footer adds up the account:

**Cleared Balance** + **Uncleared Transactions** = **Working Balance**

- **Cleared Balance** is what your bank knows about: cleared and reconciled transactions.
- **Uncleared Transactions** are the ones your bank hasn't seen yet.
- **Working Balance** is the money you actually have.

Select Cleared Balance or Uncleared Transactions to list those transactions. When you select two or more transactions, the footer shows their **Selected Total**; while you search, it shows the **Search Total**.

Hover over a running balance for a breakdown of the account on that date.

![Running balance hover text with account breakdown](/img/accounts/running-balance-light.png#light)
![Running balance hover text with account breakdown](/img/accounts/running-balance-dark.png#dark)

## Selecting transactions

- Click a transaction to select it. Click it again to edit it.
- **Ctrl+click** adds or removes a transaction; **Shift+click** selects a range.
- **Ctrl+A** selects everything; press it again to clear the selection.
- **↑** / **↓** (or **K** / **J**) move the selection.

Right-click a selected transaction for the actions menu. For every key, see [Keyboard shortcuts](../reference/keyboard-shortcuts.md#register).

![Full list of actions that can be applied to selected transactions](/img/accounts/transaction-menu-light.png#light)
![Full list of actions that can be applied to selected transactions](/img/accounts/transaction-menu-dark.png#dark)
