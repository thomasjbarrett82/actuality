# Actuality

Actuality is a desktop app for Windows, macOS and Linux that works with budgets stored on an
[Actual Budget](https://actualbudget.org) server. It's an envelope-budgeting client with the look and
workflow of a classic desktop budgeting app, modernized. The budget numbers come from Actual's own engine,
so they always match Actual's web app.

Actuality isn't affiliated with or endorsed by the Actual Budget project, and it ships no third-party
names, logos, images or fonts.

## Features

- **Accounts and the register:** on-budget and tracking accounts, inline editing, splits, transfers,
  payee auto-fill, color flags, cleared and reconciled states, a search language, undo, and
  reconciliation.
- **Budget:** envelope budgeting with month columns for Budgeted, Outflows and Balance, the Available
  to Budget header, overspending handling, Quick Budget, a calculator, notes and hidden categories.
- **Scheduled transactions:** posted by Actual's own schedule service, so they stay in step with
  other Actual clients.
- **Reports:** Summary, Spending Breakdown, Spending Comparison, Inflow vs Outflow and Net Worth, with linked filters, saved filters per report, Money Age, CSV and Print.
- **Import and export:** OFX, QFX, QIF and CSV bank files with duplicate detection; CSV and QIF export;
  budget backups; importing YNAB 4, nYNAB and Actual budget files through Actual's importer.
- **Budget management:** sign in with a password or OpenID, list, open, create and rename budgets,
  encrypted budgets, multi-user servers, and Wipe the Slate Clean.
- **Accessibility:** WCAG 2.2 AA, with full keyboard use, screen-reader support, 200 % zoom, and Light,
  Dark and color-blind-safe palettes.

Everything is saved to the server as you go. When the server can't be reached, Actuality shows your
cached budget **read-only** and explains why; it doesn't queue offline edits.

Actuality has no database of its own. The things Actuality tracks and Actual doesn't (flags, check numbers,
account types, payee settings and so on) are stored inside the Actual budget as tags, note tokens and
reserved notes, so they sync to every device. Other Actual clients will see those tags and notes.

Not supported: bank sync, budget templates and goals, and server sign-in methods other
than password and OpenID. Actuality leaves that data alone. It doesn't edit it, and it won't corrupt it.

## Requirements

- An Actual Budget server, version **26.2.0** or later. The integration suite runs against 26.2.0 and
  the latest release.
- Bundled Actual API: `@actual-app/api` 26.10.0. **Help ▸ About Actuality** shows both the bundled API
  version and the version of the server you're connected to. Connecting to a server older than 26.2.0
  shows a warning.

## Installing

Download the installer for your computer from
[GitHub Releases](https://github.com/thomasjbarrett82/actuality/releases):

| System  | Files                                                          |
| ------- | -------------------------------------------------------------- |
| Windows | `Actuality Setup {version} x64.exe` or `… arm64.exe`           |
| macOS   | `.dmg` or `.zip`, for Intel (`x64`) or Apple silicon (`arm64`) |
| Linux   | AppImage, `.deb` or `.rpm`, for `x64` or `arm64`               |

To build installers yourself, see [Packaging](#packaging).

## Development

You need **Node.js 26.10 or later** and npm.

```sh
npm install
npm run dev        # run the app with hot reload
```

| Command             | What it does                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Starts the app in development mode.                                                                        |
| `npm run check`     | Prettier, ESLint, stylelint, the `vue-tsc` typecheck, the i18n check, knip (dead code) and the docs check. |
| `npm test`          | Vitest unit and component tests.                                                                           |
| `npm run test:int`  | Integration tests against a real Actual server (see below).                                                |
| `npm run build`     | Typecheck, then build into `out/` with electron-vite, and write the third-party licenses file.             |
| `npm run test:e2e`  | Runs `npm run build`, then Playwright end-to-end tests against that build (see below).                     |
| `npm run package`   | Build installers for the current OS into `release/` with electron-builder.                                 |
| `npm run docs:site` | Starts the user guide site locally (run `npm --prefix website ci` once first).                             |

Git hooks run lint-staged and the typecheck before each commit, check commit messages with commitlint
([Conventional Commits](https://www.conventionalcommits.org)), and run `npm run check` and `npm test` before
each push.

### Integration and end-to-end tests

Both need an Actual server. The suites create throwaway budgets and delete them afterwards, and are
skipped when no server is configured. The quickest way to get a server is the Docker setup used in CI:

```sh
ACTUAL_SERVER_VERSION=26.2.0 docker compose -f tests/int/docker-compose.yml up -d --wait

ACTUAL_TEST_SERVER_URL=http://localhost:5006 ACTUAL_TEST_PASSWORD=integration-test \
ACTUAL_TEST_BOOTSTRAP=1 npm run test:int
```

To use your own server instead, copy `.env.test.example` to `.env.test.local` (git-ignored) and fill it
in. [`tests/int/README.md`](tests/int/README.md) lists the variables.

`npm run test:e2e` reads the same settings and starts the same server when it needs starting. The server
limits how often you can sign in, so after many runs against a container you started yourself, recreate it
(`docker compose … down -v`, then `up -d --wait`). Run E2E against 26.2.0, as CI does: the `latest` image's
sign-in limit is too strict for the full suite.

### Packaging

`npm run build`, then `npm run package`, builds for the OS you run it on:

| OS      | Targets                                                     |
| ------- | ----------------------------------------------------------- |
| Windows | Separate NSIS installers for x64 and arm64                  |
| macOS   | dmg and zip (x64, arm64), hardened runtime, notarized in CI |
| Linux   | AppImage, deb and rpm (x64, arm64)                          |

Code signing and notarization need credentials that only CI has.

## Project layout

```text
src/
  shared/     pure TypeScript shared by every process (money, dates, RPC contracts, domain types)
  main/       Electron main process: windows, menus, settings, secrets, logging
  preload/    the bridge between the renderer and the other processes
  host/       the API host: the only place @actual-app/api runs
  renderer/   the Vue 3 UI
tests/        integration (int/), end-to-end (e2e/) and fixture budgets (fixtures/)
docs/         architecture overview, the app specification, the release checklist
website/      the user guide: a Docusaurus site (guides in website/docs/)
references/   a local copy of the Actual API docs
```

The app runs as three processes. The **renderer** is a sandboxed Vue UI with no Node access. **Main**
handles the OS side and owns the settings and the encrypted secrets, but no budget data. The **API host**
is an Electron utility process that runs `@actual-app/api` and puts every call through a single serial
queue. Every write is refused unless the server is reachable. Money is always integer minor units.

Start with [`docs/architecture.md`](docs/architecture.md) for diagrams and the big picture. The normative
specification is in [`docs/app-spec/`](docs/app-spec/README.md); [`AGENTS.md`](AGENTS.md) summarizes its
rules for anyone, human or agent, changing the code.

## Status

Every feature in the specification is implemented. Releases, with their installers and changes, are on
[GitHub Releases](https://github.com/thomasjbarrett82/actuality/releases). The remaining release work (signed
packages, smoke tests of the packaged app on each OS, the manual screen-reader and OpenID passes, and
performance checks on the packaged build) is tracked in
[`docs/release-checklist.md`](docs/release-checklist.md).

## License

Actuality is released under the [MIT License](LICENSE). Copyright © 2026 Tom Barrett. Third-party licenses are listed under **Help ▸ About Actuality ▸ View licenses**.
