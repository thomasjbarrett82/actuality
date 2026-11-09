# Release checklist

The checklist of `21` §7 (docs/app-spec/21-testing-quality.md), with the state of each item. Items marked **Release** can only be done on the release machines or by a person; tick them
in the release notes.

| # | Item | State |
| --- | --- | --- |
| 1 | Packaged-app smoke tests on macOS and Linux, including opening a budget in a packaged host | **Release** |
| 2 | Integration suite against Actual `26.2.0` and the latest release; recorded in About and the README; the "This server runs Actual {v}…" warning | `26.2.0`: all integration tests pass locally (Docker). Latest release: **Release** (CI matrix). About shows the connected server's version and the bundled Actual API version. The app shows the warning. The README records the minimum version and the bundled API version. |
| 3 | Signed packages (Authenticode, notarized), AppImage / deb / rpm smoke-tested on Ubuntu LTS and Fedora | **Release**: needs the signing secrets and the Linux machines. Signing is required from `1.0.0` on; `0.x` releases may ship unsigned (`21` §7). |
| 4 | Manual screen-reader pass (`22` §7) on NVDA + Windows and VoiceOver + macOS, Orca smoke; axe and keyboard-only suites pass | axe suite: `tests/e2e/a11y.spec.ts` passes (every screen and dialog of the journeys, Light and Dark, 200 % reflow, WCAG 2.5.8 target size). Keyboard-only: the register journey (`tests/e2e/register.spec.ts`), the budget journey and `tests/e2e/keyboard.spec.ts` (connect, open a budget, sidebar, Reports, slate wipe dialog focus trap) run with the keyboard. The axe suite audits every Reports tab; `tests/e2e/reports.spec.ts` covers tabs, linked and saved filters. Include all tabs, charts/tables, filters, saved filters, query states, and export in the manual screen-reader pass. Manual screen-reader pass: **Release**. |
| 5 | Manual OpenID sign-in on each OS | **Release**: needs a test server with an OpenID provider. |

## Performance targets (`21` §5)

Measured on the development machine (Windows 11, unpackaged build, Docker server) with
`tests/e2e/register.spec.ts` and the 20,000-transaction fixture:

| Metric | Target | Measured |
| --- | --- | --- |
| Register open, 20k transactions | < 1.5 s | passes (the test asserts it) |
| Register search, 20k, per keystroke after the 100 ms debounce | < 200 ms | 168–211 ms. Needs the packaged-build measurement on a mid-range laptop (**Release**). |
| Wipe the Slate Clean, 1,400 transactions | (none) | about 2 s |
| Host report aggregation + DTO, 20k transactions | < 1 s, ≤ 1 MB | 102–124 ms and 1.5–6.5 KB per report (`tests/int/reports.int.test.ts` asserts the targets; local Docker 26.2.0) |

The other targets (cold start, cell commit, month navigation, memory) need the
packaged build: **Release**.

## Cutting a release

1. Actions ▸ **Release** ▸ **Run workflow** on `main`, choosing `patch`, `minor` or `major`.
2. The release pull request merges by itself when its checks pass. Don't merge other pull requests while
   it's open: a change merged before it but after it was opened ends up in neither changelog section.
   Besides the version and `CHANGELOG.md`, it adds the release's blog post
   (`website/blog/{date}-release-{version}.md`) and the regenerated news feed (`02` §3.1).
3. The CI run on `main` for the merge runs E2E, then drafts the release with the installers. The merge also
   publishes the website, so the release post and its news feed entry are live from here on.
4. Do the **Release** items above, record the results in the draft's notes, and publish it.
5. In a pull request, replace the release post's one-line summary with hand-written highlights (what
   users will notice, linking to the guide pages that describe it). Keep the post's `date`. Run
   `npm run news:build` and commit the feed with the post.
