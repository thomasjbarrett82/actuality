# 21 — Testing, Fixtures & Quality Targets

## 1. Test pyramid

| Layer | Tool | Scope | Runs |
| --- | --- | --- | --- |
| Unit (shared) | Vitest | `src/shared/**`: money parse/format, dates loose parsing, notes codec (property tests with `fast-check`), error-state rules, search parser, frequency ↔ RecurConfig mapping, quick-budget math, split auto-distribute, the news feed contract, version comparison and the news read state (`24` §3.2, §4.4) | every commit, all OS |
| Unit (host) | Vitest + a **fake Actual adapter** | services against an in-memory implementation of the `actual.ts` wrapper interface (the same TS interface as the real one) | every commit |
| Unit (main) | Vitest | the menu template (`06` §4); the news feed and update check requests (`src/main/news.ts`, `24` §4.2) with a stubbed `fetch`: the feed URL order and overrides, no request while a preference is off, the request shape (no credentials, no query string, the fixed `User-Agent`), and `null` for an invalid feed, a non-2xx status, a timeout, bad JSON or an oversized body; settings, secrets, logging and the host supervisor | every commit |
| Translations | `npm run i18n:check` (Node script) | every locale against `en`: keys, placeholders, rich-text markup, plural forms, `meta.json` (`20` §3.7) | every commit |
| Theme tokens | Vitest over the parsed `tokens.css` | all four palettes define every color token, and every size token in `05` §2–3 is defined; the contrast and color-vision checks of `05` §1.10, with no allowed failures; no hex color outside `tokens.css`, and no `px` outside the allowed uses in `05` §3.5 (stylelint) | every commit |
| Visual | Playwright `_electron` screenshots | Budget, register (with error, needs-category and review rows, multiple colored tags, a split), a TaskDialog and the Preferences/Tags screens, in all four palettes; diffs reviewed by a person | before release |
| Parsers | Vitest golden files | OFX/QFX/QIF/CSV fixtures in `src/host/parsers/fixtures/` → expected JSON | every commit |
| Component | Vitest + @vue/test-utils (happy-dom) + `vitest-axe` | editors, the common components (`17`: AutoComplete, DateField, MonthPicker, MoneyInput, Calculator, TaskDialog, StandardDialog, Callout and its placement logic, tooltip, LoadingOverlay, ConnectionBanner, buttons), commit-pipeline dialogs with mocked RPC. Callout tests cover the tail-edge naming (`top*` → below the anchor), that every `placements` list passed by a screen starts on the side the screen's spec names, and the Floating UI middleware set of `17` §3 (`flip` with `bestFit`, `shift`, `size`). Each component test also runs axe-core over the rendered DOM (color contrast excepted: happy-dom has no computed colors, and the theme-token test covers it). The notifications components (`24`): the Markdown renderer (headings demoted, raw HTML as text, only http(s) links, images as links), the bell and its badge, the Notifications dialog's states, frozen unread dots and disclosure, the toast stack (replace by id, announced without focus, F6 and Esc, inert under a modal), the "what's new" and update toasts, the Preferences section and the About status line | every commit |
| Integration (host ↔ real Actual) | Vitest, Docker `actualbudget/actual-server`, run as a matrix against two pinned versions: the **minimum supported (26.2.0)**, and the **latest** release | every supported RPC method against a real server and a seeded budget; the write gate; the main↔host control channel (secrets never reach the renderer); `session.forgetServer` leaves no cache, device settings or secrets behind; `session.signOut` deletes the token, every `e2e:` secret and `lastBudget` but keeps the cache, an offline start afterwards opens nothing, and a different user's sign-in afterwards removes the cache; cancelling the sign-in modal keeps an open budget read-only; that Actual doesn't re-apply schedule rules on `updateTransaction` (the `12` §2 restore relies on it); a transaction entered to match a schedule is linked and keeps its notes and tags, check number, category and approved state (also for **Enter in register now**); actual tag CRUD/discovery and note round-trips (multiple, case-sensitive tags, escaped hashes, colors, renaming and deletion semantics); a scheduled transfer is posted with its mirror (`12` §3); a host crash during a slate wipe shows the "partly reset" dialog after the reopen; `session.clearCache` leaves no `localId`; host crash recovery (kill the host process with a budget open, online and offline): the session reopens by itself and asks only for what wasn't stored; a stuck API call (a fake that never settles) makes the host exit and recover; a bulk action on 2,000 transactions completes within its scaled timeout; an offline start without a stored token goes to the sign-in modal when the server returns; an encrypted budget opened offline asks for its password before reconnecting, and re-auth doesn't ask again; the session start tasks (`03` §6.4) run after a reconnect from an offline start; deleting a split with a transfer line leaves no orphaned mirror; `applied` tables seen during a write job are included in its `data:changed`; a job timeout other than `init`/`openBudget` leaves the state unchanged; offline transitions (stop the container mid-test, or, against a server the tests don't control, the `fetch` and probe switch in `tests/int/network.ts`), plus a half-open TCP proxy that never answers, which must end in `OfflineReadOnly` within the fetch timeout (`03` §3); re-init in the same process after an offline start, with a write afterwards visible on a second client; `on('sync')` handlers not duplicated after re-init; a local-only session rejecting writes; the retry reachability probe (`03` §4.2): no job is queued while `/info` is unreachable, and a retry never blocks reads; a large budget opening within the 3 min job timeout; `session.probeLogin` classifying password-, OpenID- and header-auth servers from recorded `login-methods` responses (unit), and the OpenID loopback listener (unit: accepts the first `GET` with a token, ignores others, times out, cancels); the full OpenID flow **automated** against a mock OpenID provider container next to the test server (the server configured to use it; a scripted login completes the provider step, and the test asserts the loopback callback, the token `init` and the Budget List); multi-user: a `BASIC` user sees only shared and own budgets with the Shared tag, and a sign-in as a different user clears the previous user's cache; a manual OpenID sign-in against a real identity provider before each release (`21` §7); the five internal handlers (`03` §3): `category-move` / `category-group-move` (reorder within a group, across groups and between groups, checked through ActualQL `sort_order`), `schedule/get-upcoming-dates` (all 13 frequencies, including last-day-of-month), `schedule/skip-next-date` and `save-prefs { budgetName }` (rename visible on the server); this must pass on every `@actual-app/api` upgrade; the carryover extension (`09` §6.4) on a **local-only, never-uploaded** budget opened with the test-only `localTestBudget` flag (`03` §6.2), with the process clock shifted forward (never against the server: a shifted clock would sync future-dated changes); orphaned split lines (`18` §1.1) on a local-only budget: left out of the register and balances, counted by a stale budget cache until Actual's `reset-budget-cache` (test code only), and deleted by `tools/fix-split-transactions` with nothing visible changing; connection diagnosis (`03` §9.1) through a TLS proxy in front of the server, with an untrusted, a SAN-less and an expired certificate, plus plain `http://` to the TLS port | CI Linux; locally via `npm run test:int` |
| E2E | Playwright `_electron` | critical user journeys (§3) on the built app (`out/`, not packaged) | CI Linux nightly + before release; smoke on Win/mac |

The `actual.ts` wrapper is the seam: everything above it is testable without a server, and integration tests prove the wrapper's assumptions (the assumptions covered by integration tests).

## 2. Fixtures

- `tests/fixtures/budgets/typical.zip`: an Actual export built by the script `tests/fixtures/build-fixture.ts` (uses the API's `runImport`). It contains:
  - 4 on-budget accounts (Checking, Savings, Visa with a negative balance, Cash), 2 off-budget (Mortgage, 401k), 1 closed;
  - 14 months of transactions (~2,500), ending in the month the fixture is built in, incl. splits, split lines with transfers, on↔on and on↔off transfers, uncategorized, an on↔on transfer wrongly categorized, reconciled/cleared/uncleared, multiple user tags, check numbers, review tags;
  - categories with notes, a hidden category, a hidden group, carryover set in some months, a month with a hold;
  - schedules covering all 13 frequencies + one "custom" (every 3 weeks) + one with `posts_transaction: false` (the "Not entered automatically" badge, `12` §2), plus one scheduled transfer. All of them start far in the future (2036-11-03). Once a start date has passed, Actual's schedule service (`12` §2) posts the occurrences whenever a test opens the fixture, so the fixture's facts (attention counts, report totals) would depend on the day the suite runs. A test that needs occurrences inside the budget's months moves a schedule's start itself;
  - payee rename and auto-category rules, a disabled payee.
- `tests/fixtures/budgets/large.zip`: 20,000 transactions in one account (performance).
- **The fixtures are built, not committed.** Their months end in the build month, so the Budget screen opens on the fixture's last month, as the tests expect, whatever the date. A fixed set of months stops matching "the current month" once a month passes. `tests/fixtures/budgets/` is git-ignored. The integration and E2E suites' global setups run `build-fixture.ts --if-stale` (skipped when no test server is configured). It rebuilds only when its record `fixture.json` names another month, another builder source or another `@actual-app/api` version. `npm run fixtures:build` always rebuilds. The tests read the fixture's months from that record (`fixture-facts.ts`). The data comes from a fixed seed, so a rebuild has the same shape and the same facts.
- The integration setup uploads fixtures to the test server with `importBudget(zip, { type: 'actual' })`, which uploads as a new server budget. It then confirms the upload through `getBudgets()`, because upload errors aren't thrown, and deletes them afterwards with the internal `delete-budget` (test code only, not the app). `build-fixture.ts` creates the zips with `runImport` + `exportBudget`.
- `tests/fixtures/budgets/demo.zip`: the **demo budget** for the user guide's screenshots (`02` §3), built by `npm run demo:build` (`tests/fixtures/build-demo.ts`), not by the test suites, and used by no test. Unlike the fixtures it is tidy: generic payee names (no third-party names), the Personal/Family categories of `07` §4.1 in their order, and none of the fixtures' deliberate errors. It has 4 on-budget accounts (Checking, Savings, Credit Card with a negative opening balance, Cash) and 2 off-budget (Mortgage, Retirement); 14 months of transactions ending today (never future-dated), with splits, transfers, card payments, check numbers, a `#vacation` tag and reconciled months; Available to Budget 0 in every month; one overspent category in the current month and three card transactions waiting for approval, to illustrate those guide pages; and monthly schedules that start after the day it's built, so importing it posts nothing. Rebuild it before a round of screenshots, and import it into a test server (`07` §3.4). No server is needed to build it. `buildBudgetZip` takes an optional step after `runImport`, because reads of rules return nothing inside it (API 26.11.0), and a schedule's category is an action on its rule (`12` §1).

## 3. Critical E2E journeys

1. Connect → open budget → Budget screen numbers equal `getBudgetMonth` for 3 months.
2. Add a transaction with a new payee, categorize, Save and add another, split with a transfer line → the other account shows the mirror.
3. Edit a budget cell with the calculator, Tab through cells, Quick Budget "Average outflows" with confirmation.
4. Import an OFX twice → the second import reports duplicates. Approve imported transactions with "Approve and find next".
5. Reconcile with an adjustment → transactions reconciled.
6. Stop the server → banner appears and editing is disabled. Start the server → Retry → editing re-enabled. A change made just before the outage (unsynced) reaches the server after reconnecting.
7. Two app instances (two hosts, separate `dataDir`s) → a change in one appears in the other after a focus sync.
8. Slate wipe (erase all) → backup written, data cleared.
9. In the default window (1020 × 700) and at 200% zoom, open the register Timeframe callout. It opens below its button, its bounding box lies inside the viewport (title and Done visible), and when the list is taller than the room the body scrolls inside the callout. Runs in the zoom screenshots of `22` §7 too.
10. Open Reports from the sidebar and with Ctrl+R; Summary loads by default, changing a linked filter updates other linked pages, a saved-filter override remains isolated, and returning to linked filters adopts the shared values.
11. Verify Spending Breakdown and Comparison against deterministic transaction/split facts, expand/collapse Inflow vs Outflow and Net Worth tables, and confirm Summary values and future-month averages with unobserved future periods displayed as unavailable.
12. Verify Money Age FIFO allocation and partial coverage using open on-budget accounts only; unknown-age opening funds are consumed before known-age buckets and negative opening balances do not fund or offset them. Positive transaction sides in any category, including non-income refunds, create transaction-date buckets; negative income-category sides consume pool funds without counting as spending. Split lines count individually, and Starting Balance rows remain unknown-age. Verify prior-history inclusion, transaction-ID same-day tie-breaks, split-line order, credit-card purchases/payments, pool-internal transfers, and pool-exit transfers/non-spending outflows.
13. Verify signed amount aggregation across every report: negative outflows remain negative, positive amounts in non-income categories remain positive credits/refunds and reduce net outflow, and negative income-category amounts reduce net inflow. Verify Net Flow and Net Income equal signed Inflow plus signed Outflow; averages, tables, charts, and CSV preserve the same signs. Verify Spending Breakdown and Spending Comparison use the spending presentation (`15` §6): net spending displays positive, a net refund negative and without the negative-money color, and chart, table, tooltip, and CSV agree. Verify Comparison Change % uses absolute Previous so spending falling from 100 to 90 produces -10% and a net refund of -20 rising to spending of 10 produces +150%; zero Previous still uses the defined zero/"New" rules. Verify Starting Balance rows are absent from ordinary totals and transfer sides independently respect category filters and appear in their corresponding Inflow/Outflow categories. Export each report to CSV and Print; verify cancellation, errors, and masked monetary CSV values with privacy mode enabled.
14. Verify Net Worth defaults to Single; closed accounts are excluded, and selected open accounts are included regardless of their balances. Verify selected open off-budget accounts are included and unselected ones are not. Verify a range containing today plots today's balance, so an account opened since the last mid-month or month-end point is not drawn at zero.
15. Verify future flow periods display as unavailable rather than zero, do not appear as observed activity in charts, contribute zero to range totals and average numerators, and remain in average denominators. Verify Money Age's localized explanation identifies it as Actuality's custom method and disclaims direct comparison with similarly named measures.
16. Notifications (`24`, `tests/e2e/notifications.spec.ts`, no server needed): with `ACTUAL_DESKTOP_LATEST_VERSION`, the update toast shows on the Connect screen without taking focus, F6 reaches it, Esc closes it and returns focus, and it stays away after a restart; an ordinary run makes no request, and Help ▸ Notifications… shows the offline error; with `ACTUAL_DESKTOP_NEWS_URL` set to `tests/fixtures/news/news.json` and an earlier `lastSeenNewsAt`, the "what's new" toast opens the dialog, which renders the entries with their unread dots, and opening it again shows none; turning the feed off hides the Help item. The accessibility audit (`22` §7) also opens the dialog with that fixture.

## 4. Static quality

- **TypeScript only.** `allowJs: false`, and `check` fails if any `.js`, `.mjs` or `.cjs` file exists under `src/` (config files at the repo root may be `.ts` or `.mjs`). Every SFC uses `<script setup lang="ts">` (eslint-plugin-vue `vue/block-lang`), and templates are type-checked (`vueCompilerOptions.strictTemplates`).
- **Compiler options** (both tsconfig projects): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `isolatedModules`, `verbatimModuleSyntax`, `forceConsistentCasingInFileNames`, `noEmit` (vue-tsc only checks; Vite emits).
- **Lint, styles, formatting, dead code, docs and commit messages:** §4.1–4.6.
- `@actual-app/api` types are re-exported only from `host/actual.ts`.
- 100% of RPC params are validated with zod. 100% of reserved-note JSON is validated with zod.
- Coverage targets: `src/shared` ≥ 95% lines, `src/host/services` ≥ 85%, the renderer's TypeScript logic (`src/renderer/**/*.ts`, less `main.ts`, `router.ts` and the test helpers, which run end to end) ≥ 85%.
- No floating-point money: the local ESLint rule `local/no-float-money` (§4.1) flags `parseFloat`/`Number()` on money fields outside `money.ts`, plus a unit test of `money.ts` with tricky values (0.1 + 0.2, 1e15 minor units, negatives, `-0`) and 0-decimal currencies (JPY: `10000000` ↔ "¥100,000", `10000050` displays "¥100,001" (rounded half away from zero) but is never rewritten; `04` §1).

### 4.1 ESLint

Flat config in `eslint.config.ts`, using typescript-eslint's `projectService` for type information. Run with `--max-warnings 0`, so a warning fails like an error, and `--cache`.

- **TypeScript:** the type-aware `strictTypeChecked` preset, plus:
  - `no-explicit-any` everywhere in `src/` (not only `shared` and `host`);
  - `no-floating-promises` and `no-misused-promises`: every promise is awaited, returned or explicitly `void`ed, so an RPC call or API write can't be dropped silently;
  - `ban-ts-comment`: `@ts-ignore` and `@ts-nocheck` are banned; `@ts-expect-error` needs a description of at least 10 characters;
  - `consistent-type-imports`.
- **Formatting rules off:** `eslint-config-prettier` comes last and turns off every rule Prettier owns. Prettier never runs inside ESLint (no `eslint-plugin-prettier`).
- **Project rules enforced by lint:**

| Spec rule | ESLint rule |
| --- | --- |
| Every user-visible string goes through i18n (`20` §1) | `@intlify/vue-i18n/no-raw-text` in templates; `key-format-style`; keys sorted in message files (`sort-keys` via `jsonc`). Missing and unused keys are checked by `npm run i18n:check` (`20` §3.7), because the plugin's `no-missing-keys` / `no-unused-keys` can't map one file per bundle (`en/app.json` → `app.*`) |
| Never `v-html` with unsanitized strings (`20` §1) | `vue/no-v-html` as an error; the sanitized rich-text component is the only file with a disable comment |
| Accessibility (`22`) | `eslint-plugin-vuejs-accessibility` recommended rules as errors (labels, keyboard equivalents for click handlers, valid roles and ARIA attributes) |
| `main`, `host` and `renderer` import only from `shared` (`02` §3) | `eslint-plugin-boundaries` element types per process folder; `import-x/no-cycle` |
| `@actual-app/api` is imported only in `host/actual.ts`, and only dynamically (`02` §5) | `no-restricted-imports` everywhere else; a local rule bans its static import in `actual.ts` |
| No floating-point money (§4) | local rule `local/no-float-money`: `parseFloat`, `Number()`, unary `+` and `/` on values typed `Money` outside `shared/money.ts` |
| Logs go to the log files (`17` §8) | `no-console`, except in the logger module |
| Logging is an aspect (`02` §8.5) | `no-restricted-imports` of any module named `log` (`main/log`, `host/log`, `renderer/log`), except in `src/*/aspects/`, the error boundaries (`host/index.ts`, `main/index.ts`, `renderer/main.ts`) and tests |
| Vue files | `eslint-plugin-vue` `flat/recommended`, `vue/block-lang` (`ts` only), `vue/component-api-style` (`script-setup`) |
| Tests | `@vitest/eslint-plugin` (`no-focused-tests`, `no-disabled-tests`, `expect-expect`) and `eslint-plugin-playwright` (`no-focused-test`, `missing-playwright-await`) |
| Disable comments | must name the rule and give a reason (`eslint-comments/require-description`, `no-unlimited-disable`); unused ones fail (`--report-unused-disable-directives`) |

Project rules live in `eslint-rules/` as a small local plugin, with their own unit tests (`RuleTester`).

### 4.2 stylelint

`stylelint-config-standard` and `stylelint-config-recommended-vue`, run with `--max-warnings 0`, plus:

- colors only from tokens: `color-no-hex`, `color-named: "never"`, and `function-disallowed-list` for `rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklch` and `color()`, everywhere except `tokens.css`;
- sizes only from tokens: `unit-disallowed-list: ["px"]` everywhere except `tokens.css` and the allowed uses in `05` §3.5, which are listed per property in `declaration-property-unit-allowed-list` (`border*`, `outline*`, `box-shadow`, `text-shadow`);
- simple, scoped selectors: `selector-max-id: 0`, `selector-max-specificity: "0,3,0"`, `selector-max-compound-selectors: 3`;
- no `!important` (`declaration-no-important`), except in `tokens.css` reduced-motion and forced-colors blocks.

### 4.3 Formatting and line endings

- **`.gitattributes`:** `* text=auto eol=lf`, with `binary` for images, fonts, `.ico`/`.icns`, zips, PDFs and `.node` binaries. Every text file is LF in the repo and in working copies on every OS, except Windows scripts (`.bat`, `.cmd`, `.ps1`), which keep CRLF.
- **`.editorconfig`:** UTF-8, LF, 2-space indent, final newline, trim trailing whitespace (except in Markdown, where two trailing spaces can be a line break).
- **Prettier** (`prettier.config.mjs`), pinned settings so upgrades don't reformat the codebase: `printWidth: 100`, `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `arrowParens: "always"`, `endOfLine: "lf"`, `vueIndentScriptAndStyle: false`, plugin `prettier-plugin-organize-imports`. Markdown uses `proseWrap: "preserve"`, so spec paragraphs aren't rewrapped.
- **`.prettierignore`:** `out/`, `dist/`, `release/`, `coverage/`, `test-results/`, `playwright-report/`, the lockfile, `*.tsbuildinfo`, generated files (the `en-XA` pseudo-locale, `20` §3.6; the theme swatches, `theme-palettes.md` tables; `CHANGELOG.md`, `02` §5.1), test fixtures that must stay byte-exact (`tests/fixtures/`), the local-only `references/`, and `docs/`: the spec chapters are kept in shape by markdownlint (§4.5), because Prettier would rewrite their hand-aligned tables. Markdown outside `docs/` (READMEs) is formatted by Prettier.
- A Prettier upgrade that changes output lands as its own commit containing only the reformat, and that commit is listed in `.git-blame-ignore-revs` (created with the first such commit).

### 4.4 Dead code

**knip** (`knip.jsonc`, with its electron-vite, Vitest and Playwright plugins finding the main, preload, renderer and test entries, and the host entry and `scripts/` listed) fails `check` on unused files, unused exports, unused dependencies and dependencies used but not declared. An export used only inside its own file isn't reported (`ignoreExportsUsedInFile`). An intentional public export that nothing uses yet is marked with a `@public` JSDoc tag that says why. The domain model file (`src/shared/domain/types.ts`, `04`) is exempt from the unused-export check.

### 4.5 Docs checks

- **markdownlint-cli2** on `docs/**/*.md`, the user guide's `website/docs/**/*.md` and the blog's `website/blog/**/*.md` (`.markdownlint-cli2.jsonc`): the default rules, with line length (`MD013`) off because spec tables are wide, and inline HTML allowed only for the swatch images in `theme-palettes.md`. The generated `CHANGELOG.md` is ignored: it repeats its section headings in every release.
- **`scripts/docs-check.ts`** fails when:
  - a cross-reference `` `NN` §x.y `` names a chapter that doesn't exist or a section heading that chapter doesn't have (a bare `§x.y` is checked against its own chapter);
  - a CSS token (`--name`) named in a chapter isn't defined in `05`, or in `src/renderer/styles/tokens.css` once that exists;
  - a relative Markdown link or image (`[text](file.md)`, `swatches/*.svg`) points at a missing file;
  - the chapter table in `README.md` doesn't list every chapter file;
  - a user guide page (`website/docs/`, `02` §3) has no front matter line `spec: ['NN', …]` naming the chapters it describes, or names one that doesn't exist;
  - a chapter users can see is named by no guide page. The internal chapters `02`, `04`, `05`, `17`, `20` and `21` are exempt.
- **`scripts/docs-sync.ts`** (`npm run docs:sync [base] [head]`; the pre-push hook runs it from `origin/main` to `HEAD`, and CI on every pull request from its base to its head) checks that a change keeps the spec, the guide and the UI strings in step. It fails when:
  - a user-facing chapter changed but none of the guide pages that name it did, unless a commit message in the range has the line `Guide-Impact: none` (for changes users don't see);
  - a UI string in `src/shared/i18n/en/` was removed or reworded, and a spec chapter or guide page still contains its text (each part between placeholders of 10 characters or more that no current string contains).

  It passes without checking when `origin` has no `main` yet, because a repository's first push has no base to compare with. A missing `origin/main` is still an error when the remote has `main` or can't be reached.
- **`scripts/news-feed.ts --check`** (`npm run news:check`, the last step of `check`) fails when `website/static/news.json` differs from what the blog posts produce, or when the posts can't produce a feed (`02` §3.1): an opted-in post without a time and zone in its `date`, two entries with the same timestamp or slug, or a release post whose slug isn't `release-X.Y.Z`. It prints a warning for a relative image and for a link it can't make absolute. Its pure functions (`scripts/news-feed-lib.ts`, `scripts/release-post-lib.ts`) and the feed contract (`src/shared/news/feed.ts`) have unit tests: opt-in, drafts and unlisted posts, date conversion and rejection, release classification and the highlights/details split, comment and MDX removal (overlapping and unterminated comments included) that leaves fenced code blocks exactly as written, link rewriting, duplicate timestamps, sorting and the separate caps, and the contract's rejection of a wrong `schemaVersion`, a malformed entry, a non-canonical `date`, entries out of order or sharing a `date`, and a duplicate `id`.

### 4.6 Commit messages

**commitlint** with `@commitlint/config-conventional`, checked by the `commit-msg` hook and again in CI for every commit in a pull request:

- Format: `type(scope): subject`, e.g. `feat(register): add split auto-distribute` or `docs(spec): add chapter 22`.
- Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
- Scopes (`scope-enum`, optional): `main`, `host`, `renderer`, `shared`, `budget`, `register`, `reports`, `sidebar`, `import`, `i18n`, `a11y`, `theme`, `spec`, `deps`, `ci`.
- Subject in the imperative mood, no trailing full stop, header ≤ 100 characters. Trailers (`Co-Authored-By:` and similar) are allowed in the footer.
- Pull requests are squash-merged, so the pull request title becomes the commit on `main`; CI checks the title against the same rules.

## 5. Performance targets (mid-range laptop, packaged build)

| Metric | Target |
| --- | --- |
| Cold start to Budget screen (cached budget, server reachable) | < 3 s |
| Register open, 20k transactions | < 1.5 s; scrolling at 60 fps |
| Register search filter (20k) | < 200 ms per keystroke (debounced 100 ms) |
| Budget cell commit → UI updated | < 100 ms optimistic; server sync in the background |
| Cached active report, navigation to rendered results | < 2 s on `large.zip` |
| Host report aggregation + DTO serialization, 20k transaction history (including Money Age) | < 1 s; response DTO ≤ 1 MB |
| Month navigation (cached) | < 100 ms |
| Memory, steady state | < 400 MB total across processes |

**Baseline:** in plain Node, with `@actual-app/api` 26.10.0, on a local budget of 20,400 transactions:

| Query | Time |
| --- | --- |
| Register query (18 fields, grouped) | **168 ms** |
| Balance `groupBy` | 12 ms |
| 12-month category spend `groupBy` | 13 ms |
| Building the 20k budget with `runImport` + `addTransactions` (batches of 1,000) | about 14 s |

So the host query cost is about 10% of the register budget. The remaining time goes on RPC transfer, the domain mapping, and rendering, and the packaged-app measurement must cover those. The `large.zip` fixture (§2) is generated the same way, by the fixture builder (`npm run fixtures:build`).

## 6. Accessibility

- The target is WCAG 2.2 AA. Keyboard, focus, screen-reader, zoom and timing requirements, and their tests, are in `22`.
- Color is never the only signal: error levels have icons, tag pills include their names in visible text, negative amounts have a "-" sign, and cleared states and connection states have distinct glyphs.
- Four palettes: Light, Dark, Light CVD and Dark CVD (`05` §1.9). Each passes the contrast and color-vision checks in `05` §1.10.
- `prefers-reduced-motion` disables all animations.
- Text contrast ≥ 4.5:1, large text (≥ 24 px, or ≥ 18.67 px bold) and meaningful non-text marks ≥ 3:1, in every palette, with no exceptions. Every foreground is checked against every background a chapter draws it on (`05` §1.10).
- Under Windows High Contrast (`forced-colors: active`) the app stays usable: nothing is lost and focus stays visible. It isn't a designed palette.

## 7. Release checklist

1. The packaged-app smoke tests pass on macOS and Linux, including opening a budget in the packaged host.
2. The integration suite passes against the **minimum supported Actual server version, `26.2.0`** and against the latest release. Record it in About and the README. The app shows "This server runs Actual {v}. Actuality needs Actual {min} or newer." when `getServerVersion` is lower.
3. Packages are signed (Windows Authenticode, macOS notarized), required from the `1.0.0` release on. Before `1.0.0`, releases may ship unsigned: Windows SmartScreen warns about the installer, and macOS opens the app only after the user allows it in System Settings ▸ Privacy & Security. The Linux packages aren't signed. Every installer, on every OS, has a build provenance attestation instead (`02` §5.1), which the `release` job makes. AppImage, deb and rpm smoke-tested on Ubuntu LTS and Fedora.
4. The manual screen-reader pass (`22` §7) on NVDA + Windows and VoiceOver + macOS, with Orca + Linux as a smoke test; include all five Reports tabs, charts/tables, filters, saved filters, loading/errors, and exports. Record results in the release notes. The axe and keyboard-only suites pass.
5. A manual OpenID sign-in on each OS against a test server with an OpenID provider: the browser opens, the callback reaches the loopback listener, and the budget list loads (`03` §7).
