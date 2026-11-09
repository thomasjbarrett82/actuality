---
spec: ['11']
description: Add and edit transactions in the register, with payee auto-fill, tags and check numbers.
---

# Entering transactions

Transactions are entered and edited right in the register. You need a connection to your server to save them.

## Add a transaction

1. Open an account and select **Add** (or press **Ctrl+N**, or **T**). A new row opens at the top of the list.
2. Fill in the fields, pressing **Tab** to move to the next one:
   - **Date**: see [Typing dates](#typing-dates).
   - **Check #** (if the column is shown).
   - **Payee**: choose from the list or type a new one.
   - **Category**: choose from the list.
   - **Notes**: anything you like, including [tags](#tags).
   - **Outflow** for money out, or **Inflow** for money in.
3. Save it:
   - **Save and add another** (or **Enter**) saves and starts another transaction.
   - **Save** saves and closes the row.
   - **Cancel** (or **Esc** twice) discards it.

![Add transaction dialog in the register screen with editable fields](/img/accounts/add-transaction-light.png#light)
![Add transaction dialog in the register screen with editable fields](/img/accounts/add-transaction-dark.png#dark)

In **All Accounts**, an **Account** field comes first, so you can choose which account the transaction belongs to.

New transactions use the date you entered last, so a batch of receipts from the same day is quick to enter.

## Edit a transaction

Click a transaction to select it, then click it again (or press **Enter** or **F2**) to edit it. Change what you need and select **Done** (or press **Enter**). **Esc** undoes your change to the current field (in **Date**, it also closes the calendar); press it again to cancel the whole edit. **Ctrl+Enter** saves from any field.

While you have unsaved changes, clicking elsewhere in the list is blocked and the buttons glow, so you don't lose your edit by accident.

If you change the payee on a transaction, and other transactions have the same payee, Actuality asks **Apply changes to matching transactions?**. Choose to rename them all, rename and categorize the uncategorized ones, or **Leave them alone**. Ticking **Don't try to bulk-rename this payee again** turns the old payee off: you won't be asked about it again, and it also drops out of the payee list and stops filling in categories. To turn it back on, tick **List and Autocomplete this payee** in [Payee Settings](./payees-and-rules.md#payee-settings).

## Typing dates

Dates use your budget's date format, but Actuality is relaxed about what you type: `3/5`, `03-05-26` and `030526` all work, and a missing year means this year. In the Date field you can also press:

| Key | Date |
| --- | --- |
| **+** or **↑** | the next day |
| **-** or **↓** | the previous day |
| **T** | today |
| **M** / **Shift+M** | the first / last day of the month |
| **Y** / **Shift+Y** | the first / last day of the year |

Dates must be within ten years of today.

A calendar opens when you move into a date field. Select a day, or ignore it and keep typing: **Tab** closes it and moves to the next field. **Esc** closes it and undoes anything you typed; press **Esc** again to cancel the edit or dialog. The calendar button next to the field opens and closes it too.

## Payees

The **Payee** list (**Memorized Payees**) shows the payees you've used before. Type part of a name to filter it. Under **Transfer to/from account:** it lists your other accounts, for [transfers](./splits-and-transfers.md#transfers).

To add a new payee, just type its name. Select **Edit Payees** at the bottom of the list to open [Payee Settings](./payees-and-rules.md).

### Auto-fill

When you choose a payee for a new transaction, Actuality fills in the **category** you used for that payee last time (or the category set in Payee Settings). You can also have it fill in the last **notes** and **amount**: tick them under **Autocomplete (all payees)** in Payee Settings, or **Auto-fill** in Preferences.

## Categories

The **Category** list (**Budget Categories**) shows your income categories first, then each group's categories. Type the start of a name to filter it; you can type the start of the group and the category, such as `ev: gr` for "Everyday Expenses: Groceries".

If you type a category that doesn't exist, Actuality offers to create it. **Split (Multiple Categories)...** at the top of the list splits the transaction; see [Splits](./splits-and-transfers.md#splits).

If you enter an outflow in an income category, Actuality checks with you ("Just Checking...") and offers to turn it into an inflow.

## Amounts

Type the amount in **Outflow** or **Inflow**; filling one clears the other. A negative outflow becomes an inflow, and the other way round. Type **+**, **-**, **\*** or **/** to open the calculator. Selecting anywhere else closes it, and the amount you had typed before opening it stays.

## Tags

Add tags anywhere in Notes by typing `#` and a name, such as `#vacation`. As you type, Actuality suggests tags you've used. Tags are shown as colored labels; select one in the register to list every transaction with that tag. Type `##` for a plain `#`.

Tags are part of the transaction's notes, so they sync and show up in Actual's web app too. To give tags colors and descriptions, or to rename or delete them, choose **Manage Tags…** in [Preferences](../reference/preferences.md).

## Check numbers

When the **Check #** column is shown, type the check number there. Press **↑** or **+** to go up by one, or **Alt+N** for the account's next check number.

Actual has no check number field, so Actuality keeps the number inside the transaction's notes. Other Actual apps show it as part of the note text.

## Reconciled transactions

If you change the date, amount or account of a transaction you've already reconciled, Actuality warns that this may bring the reconciliation out of balance and asks before saving.

## When you're offline

If the connection to your server drops while you're editing, the row stays open with everything you typed. Saving shows "You're offline", and nothing is lost: save again once you're connected, or select **Cancel**.
