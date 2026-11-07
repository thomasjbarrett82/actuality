---
spec: ['10']
description: Find transactions with the register's search box and search terms.
---

# Searching

The search box is at the right of the register's toolbar. Select it, or press **Ctrl+F**, and start typing. As you type, a list suggests search terms: payees, categories, dates, amounts and more. Press **Enter** or type a comma to add a term.

A search can have several terms, separated by commas. A transaction must match **all** of them, except that terms of the same kind for payees, categories, accounts or tags match **any** of them. So `Payee: Kroger, Payee: Walmart` finds both stores' transactions, and `Payee: Kroger, Is: Uncleared` finds only uncleared Kroger transactions.

Press **Esc** to clear the search, or select **Clear Search** in the bar above the list.

## Search terms

| Term | Finds |
| --- | --- |
| `coffee` | Transactions with "coffee" in the payee, category, notes or check number. A number also finds that amount. |
| `Payee: Kroger` | Transactions with that payee. Part of a name finds every payee containing it. `Payee:` alone finds transactions with no payee. |
| `Category: Everyday Expenses: Groceries` | Transactions in that category. Part of a name works too. `Category:` alone finds uncategorized transactions. |
| `Account: Checking` | Transactions in matching accounts (in All Accounts). Also `Budget Accounts`, `Off-Budget Accounts` and `Closed Accounts`. |
| `Notes: refund` | Transactions whose notes contain the text. |
| `Check: 1042` | Transactions whose check number contains the number. |
| `Tag: vacation` | Transactions with exactly that tag. Tags are case-sensitive. |
| `On: 3/15/2026` | Transactions on that date. `After:` and `Before:` find dates on or after, and on or before. |
| `Outflow: 50`, `Outflow: >50`, `Outflow: <50` | Outflows equal to, at least, or at most 50. `Inflow:` works the same way. |
| `Income: March 2026` | Transactions in an income category in that month. |
| `Is: Unapproved` / `Is: Approved` | Transactions waiting for approval, or not. |
| `Is: Cleared`, `Is: Uncleared`, `Is: Reconciled`, `Is: Cleared or Reconciled`, `Is: Unreconciled` | Transactions by cleared state. |
| `Is: Error`, `Is: NeedsCategory`, `Is: Reminder` | Transactions with a problem, missing a category, or waiting for approval. |

Search words aren't case-sensitive. The English words always work, whatever language Actuality is set to.

## Searching by date

Use the **date filter** next to the search box to limit the list to **This Month**, **Latest 3 Months**, **This Year** or **Last Year**, or choose a range of months in **From:** and **Through:**. Choose **All Dates** to see everything. The date filter works on its own or together with a search.

![Search by date popup with presets and selectors](/img/accounts/search-date-light.png#light)
![Search by date popup with presets and selectors](/img/accounts/search-date-dark.png#dark)

## Splits in search results

A split transaction is shown if it, or any of its lines, matches. Lines that don't match are shown struck through, so you can see the whole transaction. The **Search Total** in the footer counts only the matching lines.

## Searches Actuality makes for you

Several places open the register with a search already filled in, such as **Show** on a message above the toolbar, the Cleared Balance and Uncleared Transactions boxes in the footer, **Show in Account View** on the budget screen, and the usage count in Payee Settings. You can edit those searches like any other.
