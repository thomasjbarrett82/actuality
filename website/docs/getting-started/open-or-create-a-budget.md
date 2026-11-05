---
spec: ['07']
description: Open a budget from your server, create a new one, or import a budget file.
---

# Open or create a budget

After you connect, Actuality shows the budget list. When you start Actuality later, it opens the budget you used last, unless you turn that off in [Preferences](../reference/preferences.md).

To come back to the budget list with a budget open, choose **File ▸ Open…** (**Ctrl+O**). **Go Back** returns to the budget you had open.

## Recent budgets

The budget list shows up to five budgets you've opened on this computer, most recent first. The most recent one is a large button with the time you last opened it.

| Icon | Meaning |
| --- | --- |
| Cloud | The budget is on your server. |
| Lock | The budget is end-to-end encrypted. |
| Small dot | A copy is saved on this computer, so you can view it offline. |

Select a budget to open it. The first time you open a budget on a computer, Actuality downloads it, which can take a moment for a large budget.

If you haven't opened any budgets yet, choose **Open an existing budget** or **Create a brand new budget**.

## Open any budget on the server

Select **Open another budget** to see every budget on your server, with whether it's encrypted and whether there's an offline copy on this computer. Double-click a budget, or select it and choose **Open**. **Refresh** reloads the list.

### Encrypted budgets

If a budget is end-to-end encrypted, Actuality asks for its encryption password each time you open it. Tick **Remember on this computer** to store the password in your operating system's secure storage so you aren't asked again.

The encryption password isn't your server password. If it's lost, the budget can't be decrypted.

## Create a new budget

1. Select **Create a new budget** (or choose **File ▸ Create a New Budget…**).
2. Enter a **Budget Name**. It must be different from your other budgets on the server.
3. Choose **Starting Categories**: **Personal/Family** or **Small Business**. You can change the categories later.
4. Choose your **Currency**, number format (**Which Format?**), **Date Format**, and whether to **Hide decimal places**.
5. Select **Create Budget**.

![Budget creation dialog example](/img/getting-started/create-new-budget-light.png#light)
![Budget creation dialog example](/img/getting-started/create-new-budget-dark.png#dark)

The Personal/Family template starts with these groups: Giving, Monthly Bills, Everyday Expenses, Rainy Day Funds, Savings Goals and Debt. The Small Business template starts with Marketing, Services, Office, General, Travel, and Taxes & Licenses. Every budget also has an Income group with the categories Income and Starting Balances.

Next, [add your accounts](../accounts-and-transactions/accounts.md) or follow the [Quick start](./quick-start.md).

## Import a budget file

On the Open Budget screen, select **Import a budget file…** and choose the type of file:

- **Actual export (.zip)**: a backup made with **File ▸ Export Budget Backup…** in Actuality, or an export from Actual.
- **YNAB 4 budget**: choose the budget's zip, or the `Budget.ymeta` file inside its `.ynab4` folder.
- **nYNAB export (.json)**.

The file is uploaded to your server as a **new** budget and opened. Budgets already on the server aren't changed. If a budget with the same name exists, the new one is named with "(imported" and the date.

If the file was a backup of a budget that has an offline copy on this computer, that copy is replaced. The budget on the server stays as it was and is downloaded again the next time you open it.

## Budgets Actuality can't open

Actual has two kinds of budget: envelope and tracking. Actuality supports envelope budgets only. If you open a tracking budget, Actuality says "This budget can't be opened in Actuality". To use it here, switch it to envelope budgeting in Actual's settings.

## Close a budget

Choose **File ▸ Close Budget** to return to the budget list.
