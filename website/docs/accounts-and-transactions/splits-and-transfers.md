---
spec: ['11']
description: Move money between accounts with transfers, and split a transaction across categories.
---

# Splits and transfers

## Transfers

A transfer moves money between two of your accounts, such as paying a credit card from checking. Actuality records both sides: an outflow in one account and an inflow in the other.

To enter one:

1. Open either account and select **Transfer** in the toolbar. The payee field starts with `Transfer:` and lists your other accounts.
2. Choose the other account, enter the date and amount, and save.

![Transfer dialog in the register screen with editable fields](/img/accounts/transfer-light.png#light)
![Transfer dialog in the register screen with editable fields](/img/accounts/transfer-dark.png#dark)

You can also type `Transfer:` followed by the account name in any transaction's payee field.

The other side appears in the other account automatically. Changes to the amount, payee, notes, tags or check number are copied to both sides, and changing the date updates the other side too. Each side has its own cleared state, because each account clears separately. Select the transfer icon in the Payee column to jump to the other side.

### Do transfers need a category?

- **Between two budget accounts:** no. The money stays in your budget, so the category reads "(Category not needed)". If such a transfer has a category, it's marked in red; choose **Remove Budget Category** from the **!** column to fix it.
- **Between a budget account and an off-budget account:** yes. Money is leaving (or joining) your budget, so the budget side needs a category, just like spending. For example, a payment toward a mortgage tracked off budget is categorized under your mortgage category.

Changing the payee of a transfer to an ordinary payee turns it into an ordinary transaction and deletes the other side. Deleting either side deletes both.

## Splits

Split a transaction when it covers several categories, such as a supermarket receipt with groceries and household goods.

1. In the **Category** field, choose **Split (Multiple Categories)...**. A split editor opens under the transaction, with two empty lines.
2. On each line, choose a category, and optionally add notes, then enter the line's amount.
3. **Add a new sub-transaction** adds a line. Entering an amount in the last line adds one automatically. The trash button deletes a line.
4. **Amount remaining to assign** shows what's left to split. When it reaches zero, save the transaction.

![Split transaction dialog in the register screen with editable fields](/img/accounts/split-light.png#light)
![Split transaction dialog in the register screen with editable fields](/img/accounts/split-dark.png#dark)

If the lines don't add up to the total when you save, Actuality asks how to handle the difference:

- **Manually adjust splits**: go back and fix the lines yourself.
- **Auto-distribute amongst splits**: share the difference among the lines in proportion to their amounts, such as sales tax.
- **Adjust original transaction**: change the total to match the lines.

Empty lines are removed when you save. A split left with a single line becomes an ordinary transaction.

In the register, a split shows "Split (Multiple Categories)..." with an arrow; select the arrow to see its lines.

### Splits with transfers

A split line can be a transfer: type `Transfer:` and an account in the line's payee field. That's how you would, for example, deposit a paycheck and move part of it straight to savings.

A transaction can't be both a split and a transfer at the top level. To split a transfer, split the transaction first, then make each line a transfer. The other sides of split transfer lines can only be changed or deleted from the split itself.
