---
spec: ['18', '03']
description: Fix budgets that won't open or sync, clear the offline cache, and find the logs.
---

# Fixing budget problems

## Split transactions look wrong

If split transactions look wrong, open your budget in Actual's web app and run **Settings ▸ Advanced settings ▸ Repair split transactions**. Actuality picks up the fix at its next sync.

## The budget won't sync on any device

If your budget won't sync on any device, open it in Actual's web app and run **Settings ▸ Advanced settings ▸ Reset sync**. Actuality will then offer to download it again.

Actuality doesn't reset sync itself, because a reset replaces the server's copy with one device's copy and can lose changes made on other devices.

## "This budget was changed on another device"

The budget's sync was reset somewhere else: for example, encryption was turned on, its password was changed, or someone ran Reset sync. The copy on this computer is out of date.

Select **Download again** to replace it with the server's copy. If the budget is encrypted, Actuality asks for the encryption password. If you had changes that hadn't reached the server, the dialog warns that they'll be lost.

## A budget won't open

| Message | What it means |
| --- | --- |
| "This budget can't be opened in Actuality" | It's a tracking budget. Actuality supports envelope budgets only; switch it to envelope budgeting in Actual's settings to open it here. |
| "That password didn't work. Try again." | The encryption password is wrong. It's the budget's encryption password, not your server password. |
| "This budget uses an old encryption format. …" | Open the budget once in Actual's web app to upgrade it, then try again. |
| "This budget no longer exists on the server." | It was deleted on the server. The budget list refreshes. |
| "This budget can't be opened. It may be damaged or from a much older version of Actual." | Try opening it in Actual's web app. If you have a backup, you can [import it](../getting-started/open-or-create-a-budget.md#import-a-budget-file) as a new budget. |

## Clear the offline cache

Actuality keeps a copy of each budget you open on your computer, so you can view it offline. If that copy seems wrong, clear it:

1. Choose **File ▸ Preferences…**.
2. Under **Offline Cache**, select **Clear Offline Cache…**, then **Clear cache**.

This removes the copies from this computer only. Your budgets on the server aren't affected, and Actuality downloads them again the next time you open them.

To remove the copies every time you quit, tick **Clear the offline cache when I quit Actuality**.

## The numbers don't match Actual's web app

Actuality's numbers come from Actual's own budget engine, so they should always match. If they don't, the two apps probably haven't synced yet: choose **File ▸ Sync Now** (**Ctrl+S**) in Actuality, and reload Actual's web app.

## A scheduled transaction appears twice

If two devices enter a scheduled transaction before either has synced, it can appear twice. Select the extra one and choose **Reject (Delete)**.

## Things to do in Actual's web app

Actuality leaves a few tasks to Actual's web app, because the budget it shows always comes from your server:

- **Repair split transactions** and **Reset sync** (see above).
- Bank sync, and managing users and budget access.

Actuality has no **Reset budget cache**. To rebuild Actuality's own copy of a budget, use [Clear Offline Cache…](#clear-the-offline-cache).

## Reporting a problem

Actuality writes a log file that can help find problems.

1. To record more detail, choose **File ▸ Preferences…** and, under **Diagnostics**, tick **Enable debug logging**. It takes effect straight away; turn it off again when you're done.
2. Make the problem happen again.
3. Choose **Help ▸ Show Logs Folder** to find the log file.

Passwords, sign-in tokens and the contents of your budget are never written to the log, and neither are amounts.

Report the problem on the project's [issue tracker](https://github.com/thomasjbarrett82/actual-desktop/issues), with what you did, what you expected, what happened, and the log file. **Help ▸ About Actuality** shows the versions to include.
