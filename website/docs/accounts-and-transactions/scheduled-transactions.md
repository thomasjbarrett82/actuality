---
spec: ['12']
description: Set up recurring and future transactions, and review the ones Actual enters for you.
---

# Scheduled transactions

Scheduled transactions are bills, paychecks and other transactions that happen on a regular schedule, or once in the future. They don't count in your balances or your budget until they're entered in the register.

## The scheduled transactions pane

Select **Scheduled Transactions** in the register's footer to open the pane under the register. The number on the button counts the account's schedules. Drag the bar between the register and the pane to resize it.

The pane lists each schedule's next **Date**, its **Frequency**, payee, category, notes and amount. In **All Accounts** it lists every schedule.

## Create a schedule

1. In the pane, select **Add** (or **Transfer** for a scheduled transfer). The **Add Schedule** dialog opens.
2. Fill in the details:
   - **Schedule name** (optional), **Payee** and **Account**.
   - **Amount**: choose **is exactly**, **is approximately** (within 7.5%) or **is between**, then **Outflow** or **Inflow**, and the amount.
   - **Category**, or **Split** to divide it across categories.
   - **Notes**.
   - **Date**: for a one-time transaction, untick **Repeats** and choose the date. For a recurring one, leave **Repeats** ticked and choose a **Frequency** and the date it **Starts**.
3. Check **Upcoming dates**, which lists the next five dates.
4. Select **Add**.

The frequencies are Daily, Weekly, Every other week, Twice a month, Every 4 weeks, Monthly, Every other month, Every 3 months, Every 4 months, Twice a year, Yearly and Every other year. For anything else, use **Repeat every**, **Add specific days** (such as the 15th, or the last Friday of each month), **Ends** (never, after a number of times, or on a date), and **Move the date when it falls on a weekend**.

You can also create a schedule from a transaction in the register: select it and choose **Make recurring...** (monthly from that transaction), or **Move to scheduler...** for a transaction dated in the future.

## How scheduled transactions are entered

Actual enters scheduled transactions for you. Once a day, after Actuality first syncs with your server, Actual's schedule service enters every scheduled transaction that's due, including any you missed while Actuality was closed. Each one appears in the register **uncleared** and **bold**, waiting for you to approve it. If you save a schedule that's already due, it's entered a few seconds later.

Check each entered transaction, then **Approve** it, or **Reject (Delete)** it if it didn't happen. See [Approving transactions](./working-with-transactions.md#approving-transactions).

Because Actual does the entering, your schedules work the same way in Actuality, Actual's web app, and on every device. Rarely, if two devices enter the same transaction before either has synced, you'll see it twice; reject the extra one.

### Entering them yourself

If you'd rather enter a schedule's transactions yourself, untick **Automatically add transaction** in its dialog. The pane marks it "Not entered automatically", and it waits until you choose:

- **Enter in register now**: enters the next occurrence straight away, already approved.
- **Skip this payment**: moves on to the next date without entering anything.

Both are on the pane's **Edit Transactions ▾** menu, and work for any schedule (skipping only applies to repeating ones).

## Transactions that match a schedule

When you enter a transaction yourself that matches a schedule's payee, account and amount on about the right date, Actual links it to the schedule, so the schedule counts it as paid and doesn't enter another one. Actuality keeps what you typed and tells you "Matched to scheduled transaction" with the payee.

In the Schedule dialog, **Linked transactions** lists the transactions linked to the schedule; **Unlink** removes a link. **Find matching transactions** lists past transactions that look like the schedule; select them and choose **Link to schedule**.

## Change or delete a schedule

- Double-click a schedule (or select it and press **Enter**) to edit it.
- **Move to account ▸** moves it to another account.
- **Delete** deletes the selected schedules straight away. There's no undo.

## Schedules from Actual's web app

Schedules created in Actual's web app appear here too. A pattern that isn't one of the standard frequencies shows a description such as "Every 3 weeks" or "Monthly on the last Friday", and can be edited like any other.
