---
spec: ['01']
description: What Actuality is, what you need to use it, and how this guide is organized.
sidebar_label: Introduction
---

# Welcome to Actuality

Actuality is a desktop app for Windows, macOS and Linux that works with budgets stored on an [Actual Budget](https://actualbudget.org) server. It's an envelope-budgeting app with the look and workflow of a classic desktop budgeting program, modernized.

With Actuality you can:

- **Budget** your money month by month, giving every dollar a job, and see exactly where Available to Budget comes from.
- **Track your accounts** in a fast register with inline editing, splits, transfers, tags, a search language and reconciliation.
- **Schedule** recurring bills and paychecks.
- **Import** statement files from your bank, and **export** or print your data.
- **Understand your spending** with five reports and a Money Age measure.

## How Actuality works with your Actual server

Actuality doesn't keep a database of its own. Your budget lives on your Actual server, and Actuality reads and writes it there:

- **Everything is saved as you go.** There is no Save button. Each change is sent to your server straight away, and **File ▸ Sync Now** (**Ctrl+S**) checks for changes made elsewhere.
- **The numbers match Actual's.** Budget amounts come from Actual's own budget engine, so Actuality always shows the same numbers as Actual's web app.
- **Your data is shared with other Actual apps.** You can open the same budget in Actual's web app or on another computer. The few things Actuality tracks that Actual doesn't (such as check numbers and which payees appear in the payee list) are stored inside the budget, so they sync to every device. Other Actual apps will see them as tags and note text.
- **No connection, no changes.** Actuality keeps a copy of each budget you open on your computer. When the server can't be reached, it shows that copy **read-only** and explains why. It never queues up changes to send later. See [Connection problems](./troubleshooting/connection-problems.md).

## What you need

- An **Actual Budget server**, version 26.2.0 or later, and its address and password (or an OpenID sign-in). If you don't have one yet, see Actual's guide to [installing a server](https://actualbudget.org/docs/install/).
- A computer running Windows, macOS or Linux.

**Help ▸ About Actuality** shows the version of Actuality, the version of the Actual software it includes, and the version of the server you're connected to.

## What Actuality doesn't do

Actuality focuses on polish and stability, and it only does what Actual's official tools support. These Actual features aren't available in Actuality, but you can still use them in Actual's web app, and Actuality leaves their data alone:

- Bank sync. Set it up and run it in Actual's web or desktop app.
- Budget templates and goals. Template lines in category notes are shown as ordinary note text.
- Tracking budgets. Actuality supports **envelope** budgets only. (Off-budget tracking *accounts* are fully supported.)
- Custom Reports and the Crossover Point report.
- Server sign-in methods other than a password or OpenID, and managing users on a multi-user server.

## About this guide

- Keyboard shortcuts are written with **Ctrl**. On macOS, use **⌘** instead, and **Option** for **Alt**.
- Menu commands are written as **File ▸ Export…**. On macOS, **Preferences…** is **Actuality ▸ Settings…**.
- Press **?** anywhere in Actuality (outside a text field) to see every keyboard shortcut.

New to Actuality? Start with [Connect to your server](./getting-started/connect-to-your-server.md), then follow the [Quick start](./getting-started/quick-start.md).

Actuality isn't affiliated with or endorsed by the Actual Budget project.
