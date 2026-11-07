---
spec: ['13']
description: Check an account against your bank statement and lock in the transactions that match.
---

# Reconciling

Reconciling checks an account against a statement from your bank, so you know Actuality and your bank agree. Reconcile each account every month or so.

## Start reconciling

1. Open the account and select **Reconcile Account** in the footer. (You can't reconcile in All Accounts, or while offline.)
2. Enter the statement's date in **What date do you want to reconcile against?**.
3. Enter the statement's balance on that date in **What is your account balance on that date?**. For a credit card or loan, enter what you owe as a negative number.
4. Select **Begin Reconciliation**, or press Enter. If the date isn't valid, Actuality shows **Invalid date** and stays on the dialog.

![Reconcile transactions starting screen to select date and amount](/img/accounts/reconcile-light.png#light)
![Reconcile transactions starting screen to select date and amount](/img/accounts/reconcile-dark.png#dark)

The dialog also shows your cleared balance in Actuality for that date. If it already matches your statement, select **Use this amount.** to start straight away. If you've just typed a new date, the first selection updates the amount for that date. Check it and select **Use this amount.** again to start.

## Match your statement

While reconciling, the register lists only transactions dated on or before the statement date that aren't reconciled yet, oldest first. The footer shows:

| Line | Meaning |
| --- | --- |
| Last cleared balance from (date) | The balance at your last reconciliation. |
| Transactions cleared above | The total of the transactions you've marked cleared in the list. |
| Cleared balance as of (statement date) | The two together. |
| Statement balance as of (statement date) | The balance you entered. |
| Difference between Actuality and your statement | What's still to find. |

Go through your statement and select the **C** on each transaction that appears on it, so it's cleared. Add any transaction that's on the statement but missing from Actuality. When the difference reaches zero, Actuality says "Great job! Your account is now reconciled".

![Reconcile transactions finishing screen with balances](/img/accounts/reconcile-finish-light.png#light)
![Reconcile transactions finishing screen with balances](/img/accounts/reconcile-finish-dark.png#dark)

Then select **Finish Reconciliation**. Every cleared transaction in the list becomes **reconciled** (shown with a lock) and the account records today as its last reconciliation, which Actual's web app shows too.

- **Adjust Statement** changes the date or balance you entered.
- **Stop Reconciling** leaves without finishing. The transactions you cleared stay cleared, so you can pick up later.

## If you can't find the difference

If you select **Finish Reconciliation** while there's still a difference, Actuality asks whether to **Create an adjustment transaction**. It adds a cleared transaction for the difference, dated the statement date, with the note "Reconciliation balance adjustment" and no payee or category. In a budget account, give it a category so your budget stays right. Or select **Continue reconciling** to keep looking.

## Changing reconciled transactions

Reconciled transactions can't be marked uncleared. If you change the date, amount or account of one, Actuality warns that it may bring the reconciliation out of balance, and asks first. Deleting one asks first too.
