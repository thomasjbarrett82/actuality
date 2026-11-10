# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project state

Actuality is an Electron + Vue 3 + TypeScript desktop client for an **Actual Budget sync server** inspired by YNAB's classic envelope-budgeting interface. Every feature in the spec is implemented: start screens, the shell and sidebar, the register, the budget screen, schedules, reconciliation, import/export and print, rules, Reports (five tabs with linked and saved filters, pure calculations in `src/shared/reporting/`, one read job per report (`reports.get`), custom SVG charts with adjacent tables, CSV and Print), Wipe the Slate Clean, About/Help, budget backup and import, privacy mode, accessibility, aspect-based debug logging, and in-app notifications (the update check and the news feed: the sidebar bell, the Notifications dialog and toasts, with the requests made by main, `24`).

Still open, because it can only be done on the release machines or by a person (`docs/release-checklist.md`): the packaged-app smoke tests on macOS and Linux, the integration run against the latest Actual release (CI matrix), signed packages, the manual screen-reader and OpenID passes, and the packaged-build performance measurements.

What exists:

- `docs/architecture.md` — tracked. Diagrams derived from the spec. Read it first for the big picture.
- `src/` — the app: `shared/` (pure TS), `main/`, `preload/`, `host/` (services in `host/services/`, file parsers in `host/parsers/`), `renderer/` (screens, components, Pinia stores, register, budget and report logic). Tests sit next to the code (`*.test.ts`); `tests/int/` (integration), `tests/e2e/` (Playwright) and `tests/fixtures/` (fixture budgets and their facts).
- `docs/release-checklist.md` — tracked. The `21` §7 checklist with each item's state and the measured performance targets.
- `docs/operations.md` — tracked. Step-by-step instructions for repository tasks: writing a blog post, cutting a release. Update it when a workflow or script it describes changes.
- `website/` — tracked. The user guide: a Docusaurus site (own `package.json` and lockfile) with task-oriented pages in `website/docs/`. Not normative; when a change alters what users see, update the guide page that describes it too (`02` §3). It also has the blog (`website/blog/`, RSS at `/blog/rss.xml`) and the news feed `website/static/news.json`, generated from the posts that set `in_app_notification: true`, which the app shows in its Notifications dialog (`24`): after changing a post, run `npm run news:build` (`02` §3.1). The steps for adding a post are in `docs/operations.md`.
- `docs/app-spec/` — the **normative spec** (chapters `01`–`24`). Tracked in git; edit it in the same change as any code that diverges from it. Cross-references like `03` §4 mean chapter `03-actual-integration.md` section 4.
- `references/actual-api/` — tracked local copy of the Actual API / ActualQL docs.

## Working agreements

- Before a change, read the spec chapter(s) for the area it touches (the chapter list is in `docs/app-spec/README.md`). Quote UI strings exactly from the message catalog (`src/shared/i18n/en/*.json`; `20-strings.md` describes its rules and bundles); every user-visible string goes through i18n. Use `APP_NAME` only for native OS metadata (window title, menus, `app.setName`); user-facing copy and message catalogs use the literal `Actuality` (no `{AppName}` placeholder, and no lint rule enforces this).
- When testing or an API behavior contradicts the spec, **stop and update the spec chapter** in the same change. Don't silently diverge. The spec describes the app as it is: state the new behavior and the reason it holds, and keep history (dates, phases, what changed) in the commit message, not in the spec. Behavior the spec settles isn't relitigated.
- **Spec, code and user guide change together.** A change users can see updates, in the same change: the code, the spec chapter that describes it, and the user guide pages whose front matter `spec: ['NN']` lists that chapter (`website/docs/`, written for users: tasks and exact UI text, no internals). A new guide page lists the chapters it describes. `docs:check` fails on a page without that list and on a user-facing chapter no page lists; `docs:sync` (pre-push hook, and CI on pull requests) fails when a user-facing chapter changes without one of its guide pages, unless a commit message has the line `Guide-Impact: none`, and when the spec or guide still quotes a UI string that was removed or reworded. Use the trailer only when users really see no difference (a clarified rationale, an internal detail).
- Preserve data the app doesn't understand: unknown note text, other tags, rule conditions, schedule patterns, account groups.
- No third-party logos, images or fonts. Third-party names only to identify what the user works with: the Actual server, a file format or program (Excel, YNAB 4), a site a link opens (GitHub, Discord) (D7).
- Shortcuts use `CmdOrCtrl` accelerators.

## Architecture invariants

Three processes (`02` §1):

- **Renderer** (sandboxed, `contextIsolation`, no Node): all UI. Bridges are only `window.app.shell.*` (to main) and the host MessagePort, which preload forwards with `window.postMessage` and `renderer/rpc/host-client.ts` picks up (`02` §4). Server data via TanStack Vue Query; view state via Pinia.
- **Main**: OS integration, owns `settings.json`, `budgets/{cloudFileId}.json` and `secrets.json` (safeStorage). Holds no budget data. Secret values never reach the renderer (it may only ask available/has/forget).
- **API host** (`utilityProcess`, singleton): the only place `@actual-app/api` runs. Talks to main over a typed `ControlApi` on `parentPort`.

Hard rules:

- `src/host/actual.ts` is the **only** importer of `@actual-app/api`, via dynamic `import()` **after** it installs the fetch timeout wrapper (the API reads `globalThis.fetch` once at load). It is also the test seam (`FakeActual` for host unit tests). Never touch `actual-cache/` files directly.
- Every API call runs inside a job on the host's **serial FIFO queue** (the API has global state).
- **Every write goes through the write gate** (checked inside the write job) and needs an integration test proving it's rejected offline. UI mirrors this with `useCanEdit()` (true only in `Online`/`Syncing`).
- Dependencies point only toward `src/shared` (pure TS, no Node/DOM). `main`, `host`, `renderer` never import each other; they meet through `shared/rpc/host-api.ts` (renderer↔host) and `shared/rpc/control-api.ts` (main↔host). Enforced by ESLint.
- RPC shape: `{id, method, params}` → `{id, ok, result | error:{code,message,details?}}`, params zod-validated in the host. After writes/sync the host emits `data:changed {tables}` and the renderer invalidates Vue Query.
- **Money** is integer minor units, always ×100 regardless of currency; no floats (ESLint). All formatting via `shared/money.ts`. Dates are `'YYYY-MM-DD'` / `'YYYY-MM'` strings, no time zones.
- No local database. App-only metadata lives inside Actual: review state as the `#needs-review` tag, check numbers as `⟦chk n⟧` note tokens, other metadata as zod-validated JSON in reserved notes (`ad:payees`, `ad:budget`, …). Reserved-note writes are read-modify-write in one queue job.
- Transaction updates and deletes go through Actual's awaited `transactions-batch-update`. The public `deleteTransaction` resolves before its write lands, so the fallback path uses the settling wrappers: a job only finishes once its writes are visible (`03` §3).
- **Logging is an aspect** (`02` §8): business code never imports a logger or calls `console.*`. Logging is woven at the composition roots (`host/index.ts`, `main/index.ts`, `renderer/main.ts`) with `shared/aspects` (`advise`/`weave`, `step` for fallible steps, `announce` for events). Main is the only file writer. ESLint rejects a logger import outside the aspects, the sinks and the composition roots.

## Commands

Commands (`02` §5.1): `npm run dev`, `npm run check` (Prettier, ESLint `--max-warnings 0`, stylelint, `vue-tsc` typecheck, `i18n:check`, knip dead code, `docs:check`, `news:check`), `npm run build` (typecheck, then electron-vite, which doesn't type-check, then the third-party licenses file; packaging with electron-builder is a separate step, run by the CI `build` job), `npm test` (Vitest unit/component), `npm run test:int` (integration against a real server: Docker `actualbudget/actual-server`, pinned 26.2.0 min + latest in CI and started by the suite itself locally, or your own via `.env.test.local`, see `tests/int/README.md`), `npm run test:e2e` (runs `npm run build`, then Playwright `_electron` against `out/`; same server settings as `test:int`), `npm run docs:site` / `docs:site:build` (the user guide, after `npm --prefix website ci`), `npm run demo:build` (the demo budget for guide screenshots, `tests/fixtures/budgets/demo.zip`, `21` §2), `npm run docs:sync [base] [head]` (the sync check the pre-push hook runs, and CI on pull requests; defaults `origin/main` and `HEAD`, committed changes only), `npm run secrets:scan [base] [head]` (gitleaks over the same range, run by the pre-push hook; needs the `gitleaks` binary on the `PATH`, e.g. `winget install Gitleaks.Gitleaks` or `brew install gitleaks`). Pin dependency versions exactly. Native module `better-sqlite3` is N-API: no `@electron/rebuild`; keep it and `@actual-app/api` external in the host Vite entry and `asarUnpack` its `.node`.
