---
description: What the Actuality app and this website send, what they keep on your computer, and how to remove it.
---

# Privacy policy

Last updated: 10 November 2026

This policy covers the Actuality desktop app and this website, actualitydesktop.org. Actuality is free,
open-source software made by Tom Barrett and the Actuality contributors.

## In short

- Your budgets go only to the Actual server you connect Actuality to. The Actuality project never receives
  them, and has no servers that could.
- Actuality has no accounts, analytics, advertising, tracking or crash reporting.
- Two features download public files from the internet: the update check and in-app notifications. They
  send nothing about you or your budgets, and you can turn each one off.

## Your Actual server

Actuality works with budgets stored on an Actual server: one you run yourself, or one run by someone you
trust. Actuality sends that server your sign-in and the changes you make, and downloads your budgets from it.
Whoever runs the server is responsible for what's stored there.

- With **end-to-end encryption** turned on for a budget, Actuality encrypts the budget before it leaves your
  computer, with a password the server never sees.
- If your server uses **OpenID**, you sign in in your web browser, with the sign-in service your server
  uses. That service's own privacy policy applies.

## Update check and in-app notifications

Both are on by default. Turn either one off in **Preferences ▸ Updates and News**; once it's off, Actuality
stops contacting that host.

| Feature                                               | What it does                                                                      | When                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Display a notification when updates are available** | Asks `api.github.com` for the latest version of Actuality.                        | When Actuality starts, then at most once a day      |
| **Show in-app notifications**                         | Downloads the latest release notes and announcements from `actualitydesktop.org`. | When Actuality starts, then at most every six hours |

Both requests are anonymous downloads of public files. They send no cookies, no user or install IDs, and no
version number. Like any request on the internet, they show the host your IP address. GitHub runs both
hosts, and
[GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
applies to them.

## Links you open

Links in Actuality, in the Help menu and in notifications for example, open in your web browser only when
you select them. From then on, that website's own privacy policy applies.

## What Actuality keeps on your computer

| What                                                                                                                                                                                      | Where it's kept                                                                   | How to remove it                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Offline copies of the budgets you open, so you can view them without a connection                                                                                                         | Actuality's data folder                                                           | **Preferences ▸ Offline Cache ▸ Clear Offline Cache…**, or tick **Clear the offline cache when I quit Actuality** |
| Your preferences, the window's size, and view settings for each budget                                                                                                                    | Actuality's data folder                                                           | Delete the data folder                                                                                            |
| Your server sign-in, if you chose **Stay signed in on this computer**, and encryption passwords you chose to remember                                                                     | Encrypted with your operating system's secure storage, in Actuality's data folder | **Sign out**                                                                                                      |
| A log file of what Actuality did, to help find problems. It never records passwords, sign-in tokens or budget contents (payees, amounts, notes, account or category names). At most 5 MB. | The `logs` folder in Actuality's data folder (**Help ▸ Show Logs Folder**)        | Delete the folder                                                                                                 |
| Exports, printouts and budget backups                                                                                                                                                     | Wherever you save them                                                            | Delete the files                                                                                                  |

Your server password is never stored. **Change server…** signs out and also removes the offline copies of
that server's budgets.

Actuality's data folder is:

- Windows: `%APPDATA%\Actuality`
- macOS: `~/Library/Application Support/Actuality`
- Linux: `~/.config/Actuality`

Uninstalling Actuality leaves this folder in place, so a reinstall keeps your settings. To remove everything
Actuality stored, quit Actuality and delete the folder.

## This website

This website is hosted on GitHub Pages. To deliver its pages, GitHub receives your IP address and the
details your browser sends with every request, and may keep them in its logs, as its
[privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
describes. The website sets no cookies, and has no analytics, advertising or third-party fonts. Your
browser remembers your choice of light or dark theme in its own storage, on your device.

## When you contact the project

Issues and discussions on GitHub are public, and GitHub's privacy statement applies to them. Before you
attach a log file, read it and remove anything you don't want to share. Turn on privacy mode
(**View ▸ Privacy Mode**) before you take screenshots, so they don't show your amounts.

## Changes to this policy

When this policy changes, the date at the top changes too. Every earlier version is in the
[website's source](https://github.com/thomasjbarrett82/actuality/commits/main/website/src/pages/privacy.md).

## Contact

For questions about this policy, [open an issue](https://github.com/thomasjbarrett82/actuality/issues). To
report a privacy problem in Actuality privately, use **Report a vulnerability** on the repository's
[Security tab](https://github.com/thomasjbarrett82/actuality/security).
