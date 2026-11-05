# Actuality — Application Specification

**Actuality** (the `APP_NAME` constant identifies the app to the operating system) is a cross-platform desktop app for **Windows, macOS and Linux**. It is a front end to an **Actual Budget sync server**. Its look and feel are inspired by YNAB 4, with a modernized look. It is built with **Electron + Vue 3 + TypeScript**.

This folder is **self-contained**: everything needed to understand the app's behavior is restated here.

## Hard requirements

1. **Platforms:** Windows, macOS and Linux desktop.
2. **Stack:** Electron, Vue.js (v3) and TypeScript.
3. **Backend:** an Actual Budget server, accessed through the official `@actual-app/api` npm package. The `@actual-app/cli` is *not* used at run time.
4. **No local database of our own.** Items may be cached locally (the Actual API keeps a cached copy of the budget; see `03` §2 and §6). **When the server is unreachable, the app does not allow changes.** It may show cached data read-only.
5. **Appearance and functionality inspired by YNAB 4.**
6. **Product direction:** Actuality prioritizes polish and stability. It is not a venue for experimental features or features that rely on functionality unsupported by the official Actual APIs.

## Design principles

| # | Principle | Consequence |
| --- | --- | --- |
| D1 | **App-only data is stored inside Actual where possible**, not locally. | User-created transaction tags use Actual's native tags in notes. Check number → token in transaction notes. "Needs approval" → the protected `#needs-review` tag. Payee "disabled", import mappings and category-month notes → JSON in **reserved Actual notes**. All of it syncs across devices, and other Actual clients will see the tags and note tokens (`04` §5). |
| D2 | **Budget numbers come from Actual's engine** (`getBudgetMonth`). | The numbers always match Actual's web UI. The reference design's per-transaction "Income: Available next month" is replaced by Actual's **Hold for next month**. Its overspending handling maps to Actual's **carryover** flag (`09` §2). |
| D3 | **Actuality supports envelope budgets only.** | The budget screen and related budget behavior follow the envelope model; Actual Budget's Tracking mode is out of scope. Off-budget (tracking) accounts remain supported. |
| D4 | **Self-contained chapters.** | Each chapter states the behavior it needs, with acceptance criteria. |
| D5 | Money is an **integer in minor units** (Actual's representation) everywhere in the app. Formatting divides by the currency's decimal places. No floating-point arithmetic on money. | Storage is always ×100, whatever the currency. All parsing and formatting goes through `shared/money.ts`, and a lint rule rejects float arithmetic on money (`04` §1, `21` §4). |
| D6 | The Actual API runs in an Electron **utility process** ("API host"), never in the renderer. | Long syncs and imports don't freeze the UI, a crashed host is restarted and the session reopened (`03` §6.5), and the renderer stays sandboxed (`02` §1). |
| D7 | No third-party names, logos, images or fonts. | User-facing application references use `Actuality` (`20` §1). Fonts and icons are open-source substitutes (`05` §2, §5). |
| D8 | Out of scope: anything not available through the API. | No features that don't exist in the Actual API (`01` §3, X5). |
| D9 | Manual **Match** of two transactions maps to Actual's `mergeTransactions`. It is destructive, so there is **no Unmatch** and no "Bank:/Yours:" sub-lines (`10` §6). | A match can't be undone, so it asks for confirmation. Import matches are tagged for review instead (X4). |
| D10 | **Four palettes:** Light (inspired by YNAB 4, with contrast fixes), Dark, and color-blind safe versions of both. Default follows the OS. | Every color is a token with four values (`05` §1). Prints use Light, or Light CVD. |
| D11 | **WCAG 2.2 AA**, with keyboard, screen-reader and zoom support specified in `22`. | Every drag has a keyboard/menu equivalent; every screen is tested with axe and keyboard-only runs. |

## Chapters

| File | Area |
| --- | --- |
| [01-product-scope.md](01-product-scope.md) | Product summary, scope, list of deviations from the reference design |
| [02-architecture.md](02-architecture.md) | Processes, modules, folder layout, tech stack, build & packaging |
| [03-actual-integration.md](03-actual-integration.md) | API host, IPC contract, connection states, the write gate, sync, offline/read-only mode, auth, encryption, errors |
| [04-data-model-and-mapping.md](04-data-model-and-mapping.md) | Domain types (TS), Actual mapping, metadata encoding (tags, tokens, reserved notes), derived states |
| [05-visual-design-system.md](05-visual-design-system.md) | Color tokens, typography, metrics, component vocabulary, icons |
| [06-app-shell-menus-shortcuts.md](06-app-shell-menus-shortcuts.md) | Window, layout tree, navigation, native menus, global shortcuts, quit flow |
| [07-startup-server-budgets.md](07-startup-server-budgets.md) | Server connection, budget list, open/create, Budget Properties, loading, Preferences, backups |
| [08-sidebar.md](08-sidebar.md) | Navigation, account groups, balances, badges, drag-and-drop, collapse, connection indicator |
| [09-budget-screen.md](09-budget-screen.md) | Envelope budget timeline, category column, month columns, cell editing, calculator, Quick Budget, popovers and Actual math |
| [10-register.md](10-register.md) | Register layout, columns, toolbar, search language, notifiers, actions menu, footer, delete/undo, keyboard |
| [11-transaction-entry.md](11-transaction-entry.md) | Inline editor, date/check/amount fields, payee & category auto-complete, auto-fill, splits, commit pipeline, payee rename prompt |
| [12-scheduled-transactions.md](12-scheduled-transactions.md) | Frequencies ↔ Actual schedules, automatic entry, scheduler pane |
| [13-accounts-reconciliation.md](13-accounts-reconciliation.md) | Create/edit/close/delete accounts, reconciliation |
| [14-payees.md](14-payees.md) | Payees, rename rules ↔ Actual rules, Payee Settings dialog |
| [15-reports.md](15-reports.md) | Five read-only reports, filters, calculations, Money Age, saved filters, CSV/Print, accessibility; Custom Reports and Crossover Point are out of scope |
| [16-import-export-print.md](16-import-export-print.md) | OFX/QFX/QIF/CSV import, export formats, printing |
| [17-dialogs-popovers.md](17-dialogs-popovers.md) | TaskDialog, standard dialogs, callouts, tooltips, loading overlay |
| [18-help-slate-wipe.md](18-help-slate-wipe.md) | Help/About, Wipe the Slate Clean |
| [19-settings-persistence.md](19-settings-persistence.md) | App preferences, per-budget device settings, synced metadata, secrets |
| [20-strings.md](20-strings.md) | i18n approach, copy-authoring guidance, and app-owned message organization |
| [21-testing-quality.md](21-testing-quality.md) | Test strategy, fixtures, test server, performance and accessibility targets |
| [22-accessibility.md](22-accessibility.md) | WCAG 2.2 AA target, keyboard model, focus rules, screen-reader semantics, announcements, zoom, accessibility tests |
| [23-rules.md](23-rules.md) | Actual's rules: model, stages, conditions and actions, the Rules dialog and the rule editor |

## Conventions

- **Exact UI text** is in "double quotes" or **bold** for button labels. A string that contains rich-text markup (`<br/>`, `**`, links; `20` §1) is written as a code span instead, so the markup stays literal. `{0}`, `{n}` and `{name}` mark placeholders (`20` §1). Every user-visible string goes through i18n (`20`).
- Sizes are CSS pixels. Colors are hex.
- Shortcuts are written with **Ctrl**. Use `CmdOrCtrl` accelerators so macOS gets **⌘**.
- Cross-references use the chapter number, e.g. `09` §5.4.
- **MUST / SHOULD / MAY** follow RFC 2119.
- "Reference behavior" means the classic behavior (inspired by YNAB 4) that the app reproduces. "Deviation" marks a deliberate difference, which is also listed in `01` §4.

## Reading order

1. `01`, `02`, `03`, `04`: scope, architecture, the Actual boundary and the data model. Every screen depends on them. Read `22` (accessibility) alongside each feature chapter.
2. Then the feature chapters, `05`–`20` and `23`, and the testing chapter `21`.
