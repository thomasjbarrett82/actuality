---
spec: ['14', '23']
description: Manage payees, rename the payee names your bank uses, auto-categorize, and edit Actual's rules.
---

# Payees and rules

## Payees

Actuality remembers every payee you use and offers it in the payee list next time. Type a payee in different capitals ("kroger") and Actuality uses the name you already have ("Kroger").

A few generic names that banks use, such as "Check", "Deposit" and "Point of Sale", are created switched off, so they don't clutter your payee list or fill in categories.

## Payee Settings

Open **Payee Settings** with **View ▸ Go to Payee Settings** (**Ctrl+Y**), **Edit Payees** at the bottom of the payee list, or **Payee settings...** in a transaction's menu. Select a payee on the left (type in **Filter payees** to find it) to change:

- **Rename**: changes the payee's name on every transaction.
- **List and Autocomplete this payee**: untick it to hide the payee from the payee list and stop it filling in categories. The count next to it shows how many transactions use the payee; select it to see them in the register.
- **Automatically categorize this payee as:** the category to fill in when you choose this payee. Without one, Actuality uses the category from the payee's last transaction.
- **Rename imported transactions to (this payee) if payee:** [rename rules](#rename-the-payee-names-your-bank-uses) for imports.
- **Associated rules**: a link to the payee's [rules](#rules), or **Create a New Rule**.

Changes are saved as you make them. Select **Close** when you're done.

### Combine payees

Select several payees with their check boxes. Under **Combine and Rename Selected Payees?**, type the **New Payee Name** and select **Combine Now**. Their transactions move to one payee, and rename rules are added so future imports use it. You can also switch several payees on or off at once with **Disable for Selected Payees** / **Enable for Selected Payees**.

### Auto-fill for all payees

At the bottom of Payee Settings, **Autocomplete (all payees):** controls what's filled in when you choose a payee for a new transaction: **Category** (on by default), **Notes** and **Amount**.

## Rename the payee names your bank uses

Banks often send payee names like "KROGER #1234 CINCINNATI". Rename rules turn them into your payee automatically when you import.

1. In Payee Settings, select your payee, such as "Kroger".
2. Under **Rename imported transactions to Kroger if payee:**, choose **Contains**, **Is**, **Starts with** or **Ends with**, and type the bank's text, such as `KROGER #`. Rules aren't case-sensitive.
3. Select **+** to add another rule, or **−** to remove one.

Rename rules apply to future imports. To apply them to transactions you already have, select **Rename Existing Payees**. Actuality shows which transactions will be renamed and asks first.

The bank's original name is kept with each imported transaction. Hover over a payee in the register to see "Imported Payee" when it differs.

## Rename a payee everywhere

Select a transaction and choose **Rename like payees...**. Type the **New payee name** and select **Rename**. Every transaction with the old payee gets the new name; if the new name is an existing payee, the two are combined. A rename rule is added so future imports use the new name too.

## Rules

Rules are Actual's way of changing transactions automatically as they arrive. They can rename payees, set categories, add notes, split transactions and more. Your rename and auto-categorize settings are rules too, as are the rules behind your schedules.

Open the rules list with **View ▸ Go to Rules** (**Ctrl+U**). Rules are listed in the order they run, with their stage and a description such as "If imported payee contains "KROGER" then set payee to Kroger". Type in **Filter rules** to find one.

- Select a rule to edit it.
- **Create a New Rule** starts a new one. You can also select a transaction and choose **Create a new rule...** to start from that transaction.
- Tick rules and select **Delete** to delete them.

### Editing a rule

- **Stage**: rules run in stage order, **Pre**, then **Default**, then **Post**. Within a stage, less specific rules run first, so a more specific rule can override them.
- **If all / any of these conditions match:** conditions on the imported payee, payee, account, category, category group, date, notes, amount, and cleared or reconciled state.
- **Then apply these actions:** set a field, add text to the notes, or delete the transaction. **Add a split** splits the transaction by fixed amounts, percentages or what remains.
- **Matching transactions** lists the transactions your conditions match. To run the rule's actions on some of them now, tick them and select **Apply Actions**. This can't be undone.

Select **Save** to save the rule.

Rules run on every new transaction: those you enter, and those imported from your bank. They don't run when you edit an existing transaction. When you enter a transaction yourself, Actuality keeps the payee, category and notes you typed, even if a rule would change them.

Rules that belong to schedules open read-only. Edit them through the schedule, with **Edit Schedule**.
