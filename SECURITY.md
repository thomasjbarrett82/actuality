# Security Policy

Actuality handles budget data, server session tokens and budget encryption passwords, so security reports
are taken seriously. Thank you for helping keep its users safe.

## Supported versions

Actuality is in `0.x` development. Security fixes go into the next release only; earlier releases are not
patched. If you find a problem in an older version, please check whether it still happens in the
[latest release](https://github.com/thomasjbarrett82/actuality/releases/latest) or on `main`.

| Version              | Supported |
| -------------------- | --------- |
| Latest `0.x` release | Yes       |
| Older `0.x` releases | No        |
| `main` (unreleased)  | Yes       |

## Reporting a vulnerability

**Please don't report security vulnerabilities in public issues, discussions, pull requests or Discord.**

Report them privately through GitHub:

1. Go to the repository's [Security tab](https://github.com/thomasjbarrett82/actuality/security).
2. Select **Report a vulnerability**.
3. Fill in the form. Only the maintainer can see it.

Please include as much of the following as you can:

- The Actuality version (**Help ▸ About Actuality**), your operating system and architecture, and the
  version of the Actual server you're connected to.
- Which part of Actuality is affected, and what an attacker could do with it.
- Steps to reproduce, or a proof of concept.
- Whether the issue is already public or known to anyone else.

Don't attach real budget files, passwords, session tokens or `secrets.json`. If you attach `app.log`,
read it first and remove anything you don't want to share. Use privacy mode for screenshots.

## What happens next

Actuality is maintained by one person in their spare time, so these are targets, not guarantees:

- **Within 14 days:** an acknowledgement that your report arrived.
- **Within 30 days:** an assessment: whether it's accepted as a vulnerability, how severe it is, and the
  planned next step.
- **Within 90 days of the report:** a fixed release, for accepted vulnerabilities. If a fix needs longer,
  for example because it depends on an Actual or Electron release, you'll be told why and given a new date.

You'll be kept up to date in the private advisory while the fix is worked on. Once a fixed release is out,
a [GitHub Security Advisory](https://github.com/thomasjbarrett82/actuality/security/advisories) is published
(with a CVE where one is warranted), and the release notes mention it. You'll be credited in the advisory
unless you'd rather not be.

Please give us a chance to fix the problem before you disclose it publicly. If 90 days pass without a fix
or an agreed new date, you're free to disclose.

## Scope

### In scope

Vulnerabilities in Actuality's own code, configuration and release process, for example:

- **Process isolation:** escaping the renderer sandbox, bypassing the Content Security Policy, navigating
  the app window to another origin, opening new windows, or reaching Node or the API host from the
  renderer other than through the defined bridges.
- **Secrets:** a server password, session token or encryption password that reaches the renderer, a log
  file, the disk outside `secrets.json`, or the network anywhere other than the user's Actual server; or a
  secret that survives **Sign out** or **Change server**.
- **Untrusted input:** imported files (OFX, QFX, QIF, CSV, YNAB 4, nYNAB, Actual backups), the in-app news
  feed and update check, Markdown rendering, and links opened in the browser (only `http:` and `https:`
  should open).
- **Network behavior:** Actuality contacting a host other than the user's Actual server,
  `actualitydesktop.org` (the news feed) and `api.github.com` (the update check); sending identifying data
  in those requests; or making them when the preference is off.
- **TLS:** accepting a certificate it should reject, including when a trusted certificate file is set.
- **Build and release:** the GitHub Actions workflows, the published installers, and the dependencies
  Actuality bundles, where Actuality's use of them makes the issue exploitable.
- **The website** at `actualitydesktop.org`, including the news feed it serves.

### Out of scope

- **Vulnerabilities in the Actual server or `@actual-app/api`.** Report those to the Actual Budget project
  through its [security page](https://github.com/actualbudget/actual/security). If the issue also affects
  how Actuality uses the API, you're welcome to report it here as well.
- Vulnerabilities in Electron, Chromium or Node.js that Actuality's configuration doesn't make worse; report
  them upstream. Tell us if Actuality ships a version with a known, exploitable issue.
- Attacks that need an attacker who already controls the user's OS account or has administrator access,
  such as reading memory or replacing the installed app.
- Behavior the user chooses and the app explains: trusting a self-signed certificate file, saving
  passwords on a system without secure storage (the option is disabled there), or connecting to an
  untrusted server over plain HTTP.
- Unsigned `0.x` installers triggering OS warnings. Signed packages are required from `1.0.0` on.
- Reports from automated scanners without a demonstrated impact, missing security headers on the static
  website with no exploit, and denial of service by flooding a server.

## Testing guidelines

When you research Actuality, please:

- Test only against an Actual server and budgets that you own or have permission to use. A local server
  from `tests/int/docker-compose.yml` works well.
- Don't access, change or delete other people's data, and stop as soon as you've shown the problem.
- Don't run denial-of-service tests against `actualitydesktop.org`, GitHub or anyone's Actual server.

We won't pursue or support legal action against anyone who researches and reports in good faith under this
policy.
