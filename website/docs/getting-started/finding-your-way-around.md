---
spec: ['06', '08', '22']
description: The sidebar, the connection indicator, menus, privacy mode, appearance and zoom.
---

# Finding your way around

With a budget open, Actuality's window has a blue **sidebar** on the left and a white **panel** on the right that shows the budget, an account register or the reports.

## The sidebar

From top to bottom:

- **Budget** opens the [budget screen](../budgets/the-budget-screen.md) (**Ctrl+B**).
- **Reports** opens the [reports](../reports/overview.md) (**Ctrl+R**).
- **All Accounts** opens a register with every transaction in every account. Its amount is the total balance of all your accounts.
- **Budget Accounts**, **Off-Budget Accounts** and **Closed Accounts** list your accounts with their balances. Select a group's name to collapse or expand it. Closed Accounts starts collapsed, and Off-Budget and Closed are hidden while they're empty.
- **Add Account** creates an account. See [Accounts](../accounts-and-transactions/accounts.md).

![Sidebar view with example data](/img/getting-started/sidebar-light.png#light)
![Sidebar view with example data](/img/getting-started/sidebar-dark.png#dark)

Select an account to open its register. Right-click it for **Rename Account**, **Edit Account Note**, **Close Account** (or **Re-open Account**), **Move Up** and **Move Down**. You can also drag an account up or down within its group.

### Badges

A colored badge on an account counts the transactions in it that need your attention:

- **red**: a transfer that shouldn't have a category,
- **orange**: transactions that need a category,
- **blue**: transactions waiting for you to approve them (imported or entered by a schedule).

The badge on a group header totals its accounts. Open the account to see and fix them; see [Working with transactions](../accounts-and-transactions/working-with-transactions.md).

### The bottom row

![Sidebar bottom row icons](/img/getting-started/sidebar-bottom-light.png#light)
![Sidebar bottom row icons](/img/getting-started/sidebar-bottom-dark.png#dark)

| Control | What it does |
| --- | --- |
| Eye | Turns [privacy mode](#privacy-mode) on or off. |
| Globe | Opens your Actual server in your web browser, where you can use the same budget in Actual's web app. |
| Connection indicator | Shows whether Actuality is connected to your server (below). Select it to sync, retry or see details. |
| « / » | Collapses the sidebar to a narrow version without balances, or expands it again. |

## The connection indicator

| Label | Meaning | Selecting it |
| --- | --- | --- |
| Connected | Connected to your server. Its tooltip shows when the budget last synced. | Syncs now. |
| Syncing… | Sending or receiving changes. | |
| Offline | Can't reach your server. Your budget is shown read-only. | Tries again. |
| Signed out | You cancelled signing in. Your budget is shown read-only. | Asks you to sign in. |
| Not synced | Your latest change is saved on this computer but hasn't reached the server yet. | Tries again. |
| Sign-in needed / Error | Something needs your attention. | Shows the details. |

Actuality syncs every minute, whenever you switch back to its window, and after every change. **File ▸ Sync Now** (**Ctrl+S**) syncs straight away and briefly shows "Synced". While offline, a yellow banner across the top of the window explains what's going on. See [Connection problems](../troubleshooting/connection-problems.md).

## Menus

- **File**: create, open and close budgets; **Sync Now**; **Export Budget Backup…**; **Wipe the Slate Clean…**; **Import Transactions from Your Bank…**; **Budget Properties…**; **Export…**; **Print…**; **Preferences…**.
- **Edit**: the usual Undo, Cut, Copy and Paste, plus Rename Account, Edit Account Note and Close Account while an account's register is shown.
- **View**: **Go to Accounts** (**Ctrl+T**), **Go to Budget** (**Ctrl+B**), **Go to Reports** (**Ctrl+R**), **Go to Payee Settings** (**Ctrl+Y**), **Go to Rules** (**Ctrl+U**), collapsing the sidebar, **Privacy Mode**, **Appearance** and zoom.
- **Help**: links to Actual Budget's own site, **Keyboard Shortcuts**, **Show Logs Folder** and **About Actuality**.

## Privacy mode

Privacy mode hides every amount on screen behind a squiggly line, so you can share your screen without showing your balances. Turn it on or off with the eye button at the bottom of the sidebar, or **View ▸ Privacy Mode** (**Ctrl+Shift+P**).

![Privacy mode example showing the budget view](/img/getting-started/privacy-light.png#light)
![Privacy mode example showing the budget view](/img/getting-started/privacy-dark.png#dark)

- Everything still works while it's on: you can budget and enter transactions as usual. An amount field shows its real value once you click in it or start typing.
- Printouts and report CSV files are masked too. Exports of your register and budget, and budget backups, always contain the real values.
- The setting is remembered on this computer until you turn it off.

## Appearance

Choose **View ▸ Appearance** to pick **Use System Setting**, **Light** or **Dark**. **Color-Blind Friendly Colors** shows positive and negative amounts and statuses in blue and orange instead of green and red. Changes apply immediately, and the same settings are in [Preferences](../reference/preferences.md).

## Zoom

**View ▸ Zoom In** (**Ctrl+=**), **Zoom Out** (**Ctrl+-**) and **Actual Size** (**Ctrl+0**) change the size of everything from 80% to 200%. At 150% and above the sidebar switches to its narrow version automatically; you can still expand it.

## Using the keyboard

Everything you can do with the mouse, you can do with the keyboard:

- Press **?** (outside a text field) to see every shortcut, with a search box.
- **F6** and **Shift+F6** move between the main areas of the window: the sidebar, the toolbar, the content, the footer and so on.
- **Shift+F10**, or the Menu key, opens the menu you'd get by right-clicking the focused item.
- Every drag has a keyboard equivalent, usually **Alt+↑** / **Alt+↓** or **Move Up** / **Move Down** in a menu.

See [Keyboard shortcuts](../reference/keyboard-shortcuts.md) for the full list.
