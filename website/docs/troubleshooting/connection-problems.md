---
spec: ['03']
description: What Actuality does when it can't reach your server, and what its connection messages mean.
---

# Connection problems

Actuality needs your Actual server to make changes. When it can't reach the server, it shows your budget **read-only** from the copy on your computer, and tells you why. It doesn't let you make changes while offline, so there's never a pile of offline edits waiting to be merged with changes made elsewhere.

## Working offline

When the connection drops, a yellow banner appears across the top of the window:

> Can't reach your Actual server. Your budget is shown as of (the last sync time) and can't be changed until the connection is restored.

The window title adds "(offline)", and the [connection indicator](../getting-started/finding-your-way-around.md#the-connection-indicator) at the bottom of the sidebar reads **Offline**.

While offline you can still view your budget and registers, search, run reports, export and print. You can't add or change anything: editing controls are disabled and show "Editing is unavailable while offline".

Actuality keeps trying to reconnect: after 5, 10 and 30 seconds, then every minute, and whenever you switch back to its window. Select **Retry now** in the banner to try straight away. When it reconnects, the banner disappears and you can carry on.

If you were in the middle of editing a transaction, it stays open with what you typed. Save it again once you're back online.

The release notes in **Notifications** and the check for a new version come from actualitydesktop.org and GitHub, not from your server (see [Updates and news](../reference/updates-and-news.md)). They can load while your server is offline, and when they can't, your budget isn't affected.

### Starting Actuality offline

If your server can't be reached when Actuality starts, it opens the budget you used last from the copy on your computer, read-only. This can take up to 15 seconds while it waits for the server. If there's no copy on this computer, the budget list says "Can't reach your Actual server at" and the address, with **Retry** and **Change server…**.

## A change that hasn't reached the server

If the connection drops just after you make a change, the change is kept on your computer and the banner says:

> Your last change is saved on this computer but hasn't reached your Actual server yet. Editing is paused until the connection is restored.

Actuality sends it as soon as the connection is back. If you close the budget or quit before then, Actuality warns "Some changes haven't reached your server" and offers **Try again**. If you quit anyway, the change is sent the next time you open the budget while connected.

## Signed out

If your server asks you to sign in again, for example because your session expired or a password changed, Actuality shows **Sign in to your Actual server**. Sign in, and Actuality carries on where you were.

If you select **Cancel**, your budget stays open read-only, and the banner says "You're signed out of your Actual server." Select **Sign in** in the banner when you're ready.

## Connection messages

| Message | What to do |
| --- | --- |
| "Couldn't reach a server at … Check the address and that the server is running." | Check the address, that the server is running, and that this computer can reach it (for example, open the address in a browser). |
| "That password is incorrect." | Check your server password. |
| "This server only accepts secure connections. Use https:// instead of http://." | Select **Use https://**. |
| "This server uses a sign-in method Actuality doesn't support yet." | Your server uses a sign-in method other than a password or OpenID. Use Actual's web app. |
| "Sign-in wasn't completed. …" | The OpenID sign-in in your browser took longer than 5 minutes or didn't come back. Try again; if your browser showed a certificate warning, see below. |
| "You don't have permission to do that on this budget. …" | On a server with several users, ask the budget's owner or the server's admin. |

### Certificate and address messages

These appear when your server uses HTTPS with a certificate your computer doesn't accept.

| Message | What to do |
| --- | --- |
| "Actuality doesn't trust the security certificate for …" | Your server uses a self-signed certificate. Select **Trust a certificate file…**, choose the server's certificate file, and restart Actuality. |
| "The security certificate for … doesn't match this address. …" | The certificate doesn't list the address you're using. Connect with an address the certificate lists, or create a new certificate for your server that includes it. Trusting the certificate file doesn't fix this. |
| "The security certificate for … has expired or isn't valid yet. …" | Renew the certificate on your server, and check that this computer's date and time are correct. |
| "Actuality couldn't make a secure connection to …" | Something else went wrong with the secure connection. The code in brackets can help your server's admin. |

Actuality never offers to skip certificate checks. To remove a trusted certificate later, go to **Preferences** under **Server**.

For OpenID sign-in, your **browser** must trust the server's certificate too, because the sign-in finishes in the browser. Trust the certificate in your operating system or browser as well.

## Actuality keeps losing its connection to Actual

Actuality runs Actual's software in a separate background process. If that process stops, Actuality restarts it and reopens your budget by itself; you'll briefly see "Reconnecting…".

If it stops three times within five minutes, Actuality says "Actuality's connection to Actual keeps stopping unexpectedly. Restart Actuality to try again." Select **Quit** and start Actuality again. If it keeps happening, select **Show Logs Folder** and include the latest log file when you [report a problem](./fixing-budget-problems.md#reporting-a-problem).
