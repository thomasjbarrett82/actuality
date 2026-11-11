---
spec: ['07', '19']
description: Every setting in Preferences, and which settings are stored where.
---

# Preferences

Choose **File ▸ Preferences…** (**Ctrl+,**). On macOS, choose **Actuality ▸ Settings…** (**⌘,**). Select **Done** when you're finished.

![Preferences screen with all system-wide options](/img/reference/preferences-light.png#light)
![Preferences screen with all system-wide options](/img/reference/preferences-dark.png#dark)

| Section | Settings |
| --- | --- |
| Startup | **On startup, open the most recently accessed budget.** |
| Server | The server you're connected to, **Sign out** and **Change server…** (see [Connect to your server](../getting-started/connect-to-your-server.md#sign-out-or-change-server)). **Stay signed in on this computer**. **Trust a certificate file…** for a server with a self-signed certificate; it takes effect after restarting Actuality. |
| Offline Cache | Where the copies of your budgets are kept on this computer, with **Show in Folder** and **Clear Offline Cache…**. **Clear the offline cache when I quit Actuality**. |
| Appearance | **Theme:** **Use system setting**, **Light** or **Dark**. **Use color-blind friendly colors** shows positive and negative amounts and statuses in blue and orange instead of green and red. |
| Tags | **Manage Tags…**: view, create, recolor, describe, rename and delete tags, choose which tags already used in notes to add (**Discover New Tags**), and see the transactions with a tag. See [Tags](../accounts-and-transactions/entering-transactions.md#tags). |
| Language | **Use system setting**, or one of Actuality's languages. |
| Auto-fill (all payees) | Whether choosing a payee fills in the **Category**, **Notes** and **Amount** from last time. The same settings are in [Payee Settings](../accounts-and-transactions/payees-and-rules.md#auto-fill-for-all-payees). |
| File Associations | **Use Actuality to open bank statement files (.OFX, .QFX, .QIF, .CSV)?** (Windows and Linux). |
| Updates and News | **Display a notification when updates are available** checks api.github.com for a new version. **Show in-app notifications (release notes and announcements)** downloads the latest posts from actualitydesktop.org and shows the bell. Nothing about you or your budgets is sent. See [Updates and news](updates-and-news.md). |
| Diagnostics | **Enable debug logging** records more detail in the log file, to help find problems. Passwords, tokens and budget contents are never recorded. |

## What's stored where

| Stored | What |
| --- | --- |
| **In the budget**, synced to every device and visible in Actual's web app | Your accounts, transactions, categories, budgeted amounts, schedules, payees and rules; budget properties such as currency and date format; notes and tags; check numbers; which payees are listed; import settings for each bank account. |
| **On this computer only** | Everything in Preferences; privacy mode; zoom; the window's size; which news posts you've seen and which update message you closed; and, for each budget, your view settings: the last screen and month, register columns and sorting, collapsed groups and report saved filters. |
| **In your operating system's secure storage** | Your server sign-in (if you chose to stay signed in) and remembered encryption passwords. Your server password is never stored. |
