---
spec: ['10']
description: Approve, clear, categorize, move, re-date, match and delete transactions, and undo a delete.
---

# Working with transactions

Select one or more transactions, then open **Edit Transactions ▾** in the toolbar, or right-click a selected transaction, for the actions menu. Many actions also have a single-letter key that works while the list has focus. Every action that changes data needs a connection to your server.

## Cleared and uncleared

The **C** column shows whether your bank knows about a transaction:

| Icon | State |
| --- | --- |
| Outline C | **Uncleared**: your bank doesn't know about it yet. |
| Filled C | **Cleared**: it has appeared at your bank. |
| Lock | **Reconciled**: it's cleared and has been [reconciled](./reconciling.md) with a statement. |

Select the C to switch between Uncleared and Cleared, or press **L** (or **Ctrl+Shift+C**). With several transactions selected, the menu has **Mark as Cleared** and **Mark as Uncleared**. Reconciled transactions don't change. Marking a transaction cleared also approves it.

## Approving transactions

Transactions imported from your bank, and transactions entered by a [schedule](./scheduled-transactions.md), arrive **bold**, waiting for you to check them. The account's badge and the message above the toolbar count them.

- **Approve** (**V**) accepts the selected transactions.
- **Reject (Delete)** deletes them.
- While editing one, **Approve and find next** approves it and opens the next one waiting.

![Approve transaction popup with approve or delete options](/img/accounts/approve-transaction-light.png#light)
![Approve transaction popup with approve or delete options](/img/accounts/approve-transaction-dark.png#dark)

Changing a waiting transaction and saving it also approves it. You can also select the icon in the **!** column for the same choices.

## Fixing missing categories

Transactions in budget accounts need a category, so the budget knows about them. Those without one show "This needs a category" in orange.

- Select the transactions and choose **Categorize As ▸** (**C**), then the category.
- Or select the icon in the **!** column to choose a category for all the selected transactions at once.

Split transactions are skipped when you categorize several at once; edit them one at a time.

## Moving transactions to another account

Choose **Move to account ▸** (**A**) and pick the account. A transfer into that account can't be moved there, and if more than one of the selected transactions is reconciled, nothing moves. Moved transactions that were reconciled become cleared.

## Changing the date of several transactions

With two or more selected, choose **Change Date…** (**E**), enter the new date and select **Change Date**. Only the date changes. The other side of a transfer moves with it.

![Change date dialog with date picker](/img/accounts/change-date-light.png#light)
![Change date dialog with date picker](/img/accounts/change-date-dark.png#dark)

## Matching two transactions

If the same transaction was entered twice, for example once by you and once by an import, select both and choose **Match** (**G**). Actuality combines them into one, keeping the imported one and filling any empty fields from the other. They must be in the same account with the same amount. The combined transaction then waits for your approval.

Matching can't be undone.

## Deleting and undo

Select the transactions and press **Delete** (or **D**; on macOS, **Backspace**), or choose **Delete** from the menu. Actuality only asks first when there's something to warn about, such as reconciled transactions or transfers, whose other side is deleted too.

After a delete, a message offers **Undo**. Select it, or press **Ctrl+Z**, to bring the transactions back. The message goes away the next time you click elsewhere.

## Other actions

| Action | What it does |
| --- | --- |
| **Rename like payees...** | Renames this payee on every transaction. See [Payees and rules](./payees-and-rules.md#rename-a-payee-everywhere). |
| **Payee settings...** | Opens [Payee Settings](./payees-and-rules.md#payee-settings) for this payee. |
| **Create a new rule...** | Starts a [rule](./payees-and-rules.md#rules) based on this transaction. |
| **Make recurring...** (**S**) | Creates a monthly [schedule](./scheduled-transactions.md) from this transaction. |
| **Move to scheduler...** | Turns a future-dated transaction into a one-time schedule. |
