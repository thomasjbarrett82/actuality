---
spec: ['16']
description: Import statement files from your bank, export your data to CSV or QIF, and print.
---

# Importing, exporting and printing

## Import transactions from your bank

Most banks let you download your transactions as a file. Actuality can import:

- **OFX** or **QFX** (recommended),
- **QIF** (if your bank doesn't offer OFX or QFX),
- **CSV** (for advanced use; see [CSV files](#csv-files)).

To import:

1. Open the account and select **Import** in the toolbar, or choose **File ▸ Import Transactions from Your Bank…** (**Ctrl+I**).
2. Select **Choose file to import...** and pick the file. (Tick **Don't show this again** to go straight to choosing a file next time.)
3. For each bank account in the file, Actuality shows how many transactions it will import, with a preview. Check the account it will go **into**, or choose **Skip this account**.
4. Select **Import** (or **Next** if the file has more accounts).

![Import data dialog with import options](/img/accounts/import-light.png#light)
![Import data dialog with import options](/img/accounts/import-dark.png#dark)

Actuality then shows how many transactions were imported, matched or skipped, and opens the account.

### What happens to imported transactions

- They're **cleared** (your bank knows about them) and arrive **bold**, waiting for you to [approve them](./working-with-transactions.md#approving-transactions).
- **Duplicates are skipped.** Importing the same file twice, or overlapping statements, doesn't add a transaction twice.
- **Existing transactions are matched.** If you already entered a transaction with the same amount and a similar date and payee, the import fills it in instead of adding another. Matched transactions wait for your approval too, so you can check the match.
- **Payees are renamed and categorized** by your [rename rules and auto-categorize settings](./payees-and-rules.md), and by any other rules you've set up.

### Options in the import dialog

- **Notes: Import** brings in the memo from the file as notes. **Swap with Payees** swaps the memo and payee, for banks that put the useful text in the memo.
- **Date Format** appears for QIF and CSV files when the dates could be read more than one way, such as 03/04/2026.
- If the file has transactions dated before the account's starting balance, Actuality warns you. Tick **Include transactions dated before account start date** to import them; the starting balance is adjusted so the account's balance stays right.

For OFX and QFX files (and QIF files with an account number), Actuality remembers your choices for each bank account, so the next import is quicker.

### CSV files

CSV files must have a header row with these column names, spelled exactly:

| Column | Contents |
| --- | --- |
| Date | Required. |
| Payee | |
| Category | As "Group: Category" or just the category name. |
| Notes | |
| Outflow and Inflow | Money out and money in. Or use a single **Amount** column, negative for money out. |
| Check | Optional check number. |

If a CSV file can't be read, Actuality offers to save a sample CSV file that shows the format it expects.

### Opening bank files directly

On Windows and Linux, tick **Use Actuality to open bank statement files** in [Preferences](../reference/preferences.md) to open `.ofx`, `.qfx`, `.qif` and `.csv` files with Actuality. On macOS, Actuality can always open them.

## Export your data

Choose **File ▸ Export…** (**Ctrl+E**) and choose:

- **Export to CSV**: two files, one with your transactions (Register) and one with your budget (Budget), for Excel and other spreadsheet programs.
- **Export to QIF**: your transactions, one file per account, for other financial programs. Budget data isn't included.
- **Export Budget to CSV** (from the budget screen): just the budget.

![Export data dialog with export options](/img/accounts/export-light.png#light)
![Export data dialog with export options](/img/accounts/export-dark.png#dark)

From a register, tick **Export current register view only** to export just the account and transactions you're looking at. Then choose a folder. Exports work offline.

For a complete copy of your budget that you can restore later, use **File ▸ Export Budget Backup…** instead; see [Back up a budget](../budgets/managing-budgets.md#back-up-a-budget). To export a report, use the report's **Export** menu; see [Reports](../reports/overview.md#export-and-print).

## Print

Choose **File ▸ Print…** (**Ctrl+P**) to print what you're looking at:

- on the **budget screen**, the selected month's budget with its header summary,
- in a **register**, the transactions shown, with the current search and date filter,
- in **Reports**, the current report with its chart and table.

A preview opens first, with **Print…** and **Save as PDF…**. Printouts always use light colors. In [privacy mode](../getting-started/finding-your-way-around.md#privacy-mode), amounts are hidden in the printout too.
