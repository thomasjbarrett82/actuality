---
spec: ['07', '18']
description: Budget properties, end-to-end encryption, backups, and wiping the slate clean.
---

# Managing your budget

## Budget properties

Choose **File ▸ Budget Properties…** to change:

- the **Budget Name**,
- the **Currency**, number format (**Which Format?**), **Date Format** and **Hide decimal places**,
- the **First day of week**, which sets the first column of every calendar and how weekly reports are grouped.

![Options screen for budget-specific properties](/img/accounts/budget-properties-light.png#light)
![Options screen for budget-specific properties](/img/accounts/budget-properties-dark.png#dark)

Select **Save Changes**. These settings are stored in the budget, so they apply on every computer and in Actual's web app.

While offline, Budget Properties opens read-only. On a server with several users, you can't rename a budget someone else owns.

## End-to-end encryption

End-to-end encryption protects your budget data on the server with a password that only you know. It's set up per budget, in **File ▸ Budget Properties…** under **End-to-end encryption**.

- **Enable encryption** turns it on. Enter an encryption password (different from your server password). Tick **Remember on this computer** to store it in your operating system's secure storage.
- If encryption is already **Enabled**, **Generate a new key** replaces the key, for example to change the password.

Before you go ahead, know that:

- **It resets sync.** The budget on this computer becomes the copy every other device downloads. Changes on other devices that haven't synced yet can be lost, so **sync your other devices first**.
- **A forgotten password can't be recovered.** Without it, the budget on the server can't be decrypted.
- **It can't be turned off.** To get an unencrypted budget, export a backup and import it as a new budget.
- **Not everything is encrypted.** The offline copy on your computer and budget backups aren't encrypted, and bank-sync credentials aren't covered.

Other devices will need to download the budget again and enter the password. Actuality asks for the password each time you open an encrypted budget, unless you chose to remember it.

## Back up a budget

Choose **File ▸ Export Budget Backup…** and choose where to save the zip file. When it's done, select **Show in Folder** to find it.

A backup has everything in the budget. It isn't encrypted, so keep it somewhere safe.

To restore a backup, choose **File ▸ Open…**, then **Open another budget** and **Import a budget file…**, and choose **Actual export (.zip)**. The backup is uploaded as a **new** budget; the original isn't changed. See [Import a budget file](../getting-started/open-or-create-a-budget.md#import-a-budget-file).

## Wipe the Slate Clean

**File ▸ Wipe the Slate Clean…** lets you start budgeting from today without setting everything up again. It keeps your accounts, scheduled transactions and categories, and deletes all transactions and budgeted amounts.

1. Choose **File ▸ Wipe the Slate Clean…**.
2. Check where the backup will be saved. Actuality always saves a backup of your budget first; select **Change…** to save it somewhere else.
3. Select **Wipe the Slate Clean**, then confirm.
4. When it's done, open each account and [reconcile](../accounts-and-transactions/reconciling.md) it to enter its current balance.

![Dialog that explains wiping the slate clean and a backup location](/img/accounts/wipe-slate-light.png#light)
![Dialog that explains wiping the slate clean and a backup location](/img/accounts/wipe-slate-dark.png#dark)

On a large budget this can take several minutes. It can't be undone, except by restoring the backup.

### Keep recent history

To keep recent transactions and delete only older ones, hold **Alt** while the dialog is open. **Delete everything before:** appears; choose the first month to keep. Actuality deletes transactions and budgeted amounts before that month, adds a Starting Balance transaction to each account so its balance is unchanged, and carries each category's balance forward.
