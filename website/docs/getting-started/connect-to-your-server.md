---
spec: ['07', '03']
description: Sign in to your Actual Budget server with a password or OpenID, and stay signed in.
---

# Connect to your server

The first time you start Actuality, it asks for your Actual server. You only need to do this once: Actuality remembers the server, and can remember your sign-in too.

## Sign in with a password

1. In **Server address**, type the address you use to reach your server in a browser, for example `https://budget.example.com`. It must start with `http://` or `https://`.
2. Type your server's **Password**.
3. Leave **Stay signed in on this computer** ticked if you don't want to sign in each time you start Actuality.
4. Select **Connect**.

Actuality checks how your server signs people in as soon as you leave the address field, so the rest of the screen may change to match your server.

When you're connected, Actuality shows your budgets. Continue with [Open or create a budget](./open-or-create-a-budget.md).

:::tip Don't have a server yet?

The link **Don't have a server? Learn how to set one up.** opens Actual's guide to installing a server.

:::

## Sign in with OpenID

If your server uses OpenID (single sign-on), the password field is replaced by "This server signs in with" and the name of your sign-in provider, and the button reads **Sign in with** that provider.

1. Select the **Sign in with** button. Actuality opens your web browser at your provider's sign-in page and shows "Waiting for you to sign in to … in your browser…".
2. Sign in in the browser. When it says "You're signed in to Actuality. You can close this tab.", close the tab. Actuality comes back to the front, signed in.

If you don't finish within 5 minutes, Actuality stops waiting and asks you to try again. Select **Cancel** to stop waiting sooner.

:::note Certificates and your browser

If your server uses a self-signed certificate, your browser must trust it as well as Actuality. Actuality's own certificate setting doesn't apply to your browser, and without it the sign-in never comes back to Actuality.

:::

If the screen says "This server uses a sign-in method Actuality doesn't support yet.", your server uses a sign-in method other than a password or OpenID. Use Actual's web app with that server instead.

## Staying signed in

When **Stay signed in on this computer** is ticked, Actuality stores a sign-in token for your server in your operating system's secure storage. It never stores your password. When it's off, Actuality asks you to sign in each time it starts (on an OpenID server, that means a trip through the browser).

You can change this later in **File ▸ Preferences…** under **Server**.

## Servers with a self-signed certificate

If your server uses a certificate that your computer doesn't trust, Actuality says it doesn't trust the security certificate and offers **Trust a certificate file…**. Choose your server's certificate file (`.pem`, `.crt` or `.cer`), then restart Actuality. You can also do this, or remove the certificate, in **Preferences** under **Server**.

Actuality never offers to skip certificate checks. For the other certificate messages, see [Connection problems](../troubleshooting/connection-problems.md#certificate-and-address-messages).

## Servers with several users

On a server with several users, the budget list shows only the budgets you can open. A budget someone else owns has a **Shared** tag. Some changes, such as renaming a shared budget, may be refused with "You don't have permission to do that on this budget. Ask the budget's owner or the server's admin."

Users and budget access are managed in Actual's web app, not in Actuality.

## Sign out or change server

Both are on the budget list and in **Preferences** under **Server**.

- **Sign out** removes your sign-in and any remembered encryption passwords from this computer, so the next person has to sign in. Copies of budgets stay on this computer. If someone else signs in next, Actuality removes the budgets they can't open.
- **Change server…** signs out and removes **everything** from the current server from this computer: copies of budgets, recent budgets, remembered passwords and settings. Your budgets on the server aren't affected. Actuality asks before it does this.

If you have changes that haven't reached the server yet, Actuality warns you first and offers **Try again**.
