---
description: How Actuality's Windows installers are signed, who approves a signed release, and what Actuality sends over the network.
---

# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

## What's signed

The Windows installers on [GitHub Releases](https://github.com/thomasjbarrett82/actuality/releases),
`Actuality-Windows-{version}-x64.exe` and `Actuality-Windows-{version}-arm64.exe`, are signed. Windows shows
their publisher as SignPath Foundation.

- **Built from source.** GitHub Actions builds every installer from the source in the
  [Actuality repository](https://github.com/thomasjbarrett82/actuality), using the build scripts and the
  [CI workflow](https://github.com/thomasjbarrett82/actuality/blob/main/.github/workflows/ci.yml) kept in
  that repository. Nothing built on a personal computer is signed.
- **Approved by hand.** Only a release build can be signed, and each signing request waits until an
  approver approves it.
- **The installer, not its contents.** The files inside the installer, including the
  [Electron](https://www.electronjs.org/) runtime that Actuality is built on, aren't signed one by one.

## Team roles

| Role                     | Who                                                |
| ------------------------ | -------------------------------------------------- |
| Committers and reviewers | [Tom Barrett](https://github.com/thomasjbarrett82) |
| Approvers                | [Tom Barrett](https://github.com/thomasjbarrett82) |

Committers merge their own changes without further review. Every pull request from anyone else is reviewed
by a reviewer before it's merged. Approvers decide whether a release is signed. Every team member signs in
to GitHub and SignPath with multi-factor authentication.

## Privacy policy

Actuality sends your budgets only to the Actual server you connect it to, and collects no analytics or
crash reports. Two features, the update check and in-app notifications, download public files from
GitHub-hosted sites without sending anything about you; you can turn each one off. The
[privacy policy](/privacy) has the details.
