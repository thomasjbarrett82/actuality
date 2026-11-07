# 02 — Architecture, Tech Stack, Build & Packaging

## 1. Process model

```text
┌──────────────────────────── Electron app ─────────────────────────────────────────────────┐
                                                                                    
  MAIN PROCESS (Node)                                                               
   • app lifecycle, single-instance lock, BrowserWindow, native Menu, accelerators  
   • file dialogs, shell.openExternal/openPath, print/printToPDF                    
   • settings files (JSON) + secrets (safeStorage)                                  
   • spawns and supervises the API host; brokers a MessagePort to the renderer      
        │ MessagePortMain                         │ ipcMain (shell services)        
        ▼                                         ▼                                 
  API HOST (utilityProcess, Node)          RENDERER (Chromium, sandboxed)           
   • @actual-app/api (single instance)      • Vue 3 + Pinia + TanStack Vue Query    
   • service layer (commands/queries)       • all screens/components                
   • connection monitor + write gate        • view state, keyboard, dialogs         
   • import parsers, export writers         • calls host via typed RPC over port    
   • serial job queue                       • calls main via preload `shell` API
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Rules:

1. The renderer has `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. Its only bridges are the preload `window.app` object (`shell.*` calls to main, and a `MessagePort` for host RPC). It MUST NOT import `@actual-app/api`.
2. The **API host** is the only place that imports `@actual-app/api`. The API keeps global state (one open budget at a time), so the host is a singleton, and every API call goes through a **serial FIFO queue** (`03` §3). Running it in a utility process keeps long syncs and imports from freezing the UI. It can also be restarted if it crashes: main restarts it, the renderer shows "Reconnecting…", and the new host reopens the session automatically (`03` §6.5). Going offline and reconnecting **don't** restart it: the host re-inits the API in the same process (`03` §6.2).
3. Business rules that need API data in bulk (commit pipeline, import, schedule entry, slate wipe) live in the host's **service layer**. Pure rules and formatting live in `src/shared` and are unit-tested. Both sides use them.
4. The main process holds no budget data.
5. Main owns the settings files and secrets (`19`). The host reaches them, and the few OS services it needs, through the **control channel** (§4.1). Secrets travel only between main and the host, never to the renderer.

## 2. Tech stack

Pin the exact latest stable versions when scaffolding. Record them in `package.json` with exact versions and Renovate/Dependabot.

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | **Electron** (current stable) | Node ≥ 22.14 inside (the Actual CLI docs require Node 22; `better-sqlite3`'s N-API 10 binary needs ≥ 22.14, see §5). |
| Build | **electron-vite** (Vite for main, preload, renderer, and a 4th entry for the API host) | |
| UI | **Vue 3** (`<script setup lang="ts">`, Composition API), **Vue Router** (hash history) | No UI component library. Components are custom-styled in a look inspired by YNAB (`05`). |
| State | **Pinia** for UI/view state; **@tanstack/vue-query** for server data (cache, invalidation, refetch) | `03` §5 |
| Language | **TypeScript** only, strict (compiler options in `21` §4); `moduleResolution: "bundler"` (required by `@actual-app/api` typings). No JavaScript source files. | `21` §4 |
| Validation | **zod** for IPC payloads and reserved-note JSON | |
| Virtual lists | **@tanstack/vue-virtual** | register and scheduler |
| Popover positioning | **@floating-ui/dom** | callouts with tail positions (`17`) |
| Dates | **date-fns** (no time zones; dates are `YYYY-MM-DD` strings) | |
| i18n | **vue-i18n** (composition mode), message files generated from `20` | |
| Fonts | **Source Sans 3** via `@fontsource/source-sans-3` (OFL) | substitutes Myriad Pro |
| Icons | an open-source icon set (e.g. **Lucide** via `lucide-vue-next`) + custom SVGs for cleared states | no third-party images |
| Secrets | Electron **safeStorage** | `19` §4 |
| Settings files | plain JSON with atomic write (write temp + rename), schema-versioned | not a database |
| Unit tests | **Vitest** (+ `@vue/test-utils`, `happy-dom`, `fast-check` for property tests, `vitest-axe` / `axe-core` for component accessibility) | |
| E2E | **Playwright** `_electron` | against a real `actualbudget/actual-server` Docker container |
| Type checking | **vue-tsc** (checks `.ts` and `.vue`, templates included) | §5.1 |
| Lint | **ESLint** flat config with typescript-eslint (type-aware `strictTypeChecked`, `projectService`), eslint-plugin-vue, `@intlify/eslint-plugin-vue-i18n`, `eslint-plugin-vuejs-accessibility`, `eslint-plugin-boundaries`, `eslint-plugin-import-x`, `@vitest/eslint-plugin`, `eslint-plugin-playwright`, `@eslint-community/eslint-plugin-eslint-comments`, `eslint-config-prettier`, and a local plugin for project rules | `21` §4.1 |
| Styles lint | **stylelint** with `stylelint-config-standard` and `stylelint-config-recommended-vue` | `21` §4.2, `05` |
| Format | **Prettier** (+ `prettier-plugin-organize-imports`), **EditorConfig**, `.gitattributes` | `21` §4.3 |
| Dead code | **knip** | `21` §4.4 |
| Docs | **markdownlint-cli2** + `scripts/docs-check.ts` | `21` §4.5 |
| Git hooks | **simple-git-hooks** + **lint-staged** + **commitlint** (`@commitlint/config-conventional`) | §5.1, `21` §4.6 |
| Packaging | **electron-builder** | §5 |

## 3. Repository layout

```text
actuality/
├─ package.json, electron.vite.config.ts, electron-builder.yml, tsconfig*.json, .nvmrc
├─ eslint.config.ts, stylelint.config.mjs, prettier.config.mjs, .prettierignore, knip.jsonc,
│  commitlint.config.mjs, .markdownlint-cli2.jsonc, .editorconfig, .gitattributes
├─ eslint-rules/                (local ESLint plugin: project rules such as no-float-money — 21 §4.1)
├─ scripts/                     (docs-check.ts and other repo scripts, run with tsx)
├─ docs/                         (specs)
├─ website/                      (the user guide: a Docusaurus site with its own package.json and lockfile;
│                                 guides in website/docs/, written for users, not normative — see below)
├─ resources/                    (app icons placeholder set, sample CSV, licenses)
├─ src/
│  ├─ shared/                    (pure TS, no Node/DOM APIs; imported by all)
│  │  ├─ money.ts                (minor-unit math, parse/format, currency decimals)
│  │  ├─ dates.ts                (YYYY-MM-DD / YYYY-MM helpers, loose parsing — 11 §3)
│  │  ├─ domain/                 (types from 04, error-state rules, transfer rules)
│  │  ├─ metadata/               (notes token codec, tag names, reserved-note schemas — 04 §5)
│  │  ├─ search/                 (register search parser + predicate builder — 10 §4)
│  │  ├─ schedule/               (frequency ↔ RecurConfig mapping — 12 §1)
│  │  ├─ quickbudget/            (average/history math — 09 §5)
│  │  ├─ i18n/                   (message files per locale + meta.json; translate.ts for main — 20 §3)
│  │  └─ rpc/                    (host-api.ts: renderer↔host methods, error codes;
│  │                              control-api.ts: main↔host control channel — §4.1)
│  ├─ main/                      (Electron main)
│  │  ├─ index.ts, window.ts, menu.ts, shortcuts.ts
│  │  ├─ host-supervisor.ts      (spawn/restart utility process, port brokering)
│  │  ├─ settings-store.ts, secrets.ts, dialogs.ts, print.ts
│  ├─ preload/index.ts           (contextBridge: window.app)
│  ├─ host/                      (API host utility process)
│  │  ├─ index.ts                (port listener, RPC dispatch)
│  │  ├─ actual.ts               (thin wrapper over @actual-app/api — the ONLY importer)
│  │  ├─ queue.ts, connection.ts (serial queue, connection monitor, write gate)
│  │  ├─ services/               (session, budgetFile, accounts, transactions, budget, categories,
│  │  │                           notes, payees, schedules, reconcile, import, export,
│  │  │                           slateWipe, prefs — one per RPC group in the 03 catalog — and metadata)
│  │  └─ parsers/                (ofx, qif, csv)
│  └─ renderer/
│     ├─ index.html, main.ts, App.vue, router.ts, i18n.ts
│     ├─ styles/                 (tokens.css, base.css — 05)
│     ├─ rpc/                    (typed client over MessagePort, vue-query keys)
│     ├─ stores/                 (Pinia: app, connection, budgetView, registerView, dialogs)
│     ├─ components/common/      (Callout, TaskDialog, AutoComplete, MoneyInput, DateField, Calculator…)
│     ├─ screens/
│     │  ├─ start/               (Connect, BudgetList, BudgetSetup, Loading, Preferences)
│   │  ├─ shell/               (MainCanvas, Sidebar, WelcomePanel, ConnectionBanner)
│     │  ├─ budget/, register/
│     │  └─ dialogs/             (CreateAccount, AccountBalance, Reconcile, PayeeSettings, Import…, SlateWipe, About)
│     └─ keyboard/               (central key dispatcher — 06 §6)
└─ tests/ (unit fixtures, e2e, docker-compose for test server)
```

**The user guide** (`website/`) is a static Docusaurus site of task-oriented guides for people using the app. This specification stays the normative description of behavior; when the app changes, update the guide pages that describe it in the same change, and quote UI text exactly, as here. Each page's front matter lists the chapters it describes (`spec: ['09']`), which `docs:check` and `docs:sync` use to keep the two in step (`21` §4.5). The site has its own dependencies (Docusaurus and React), kept apart from the app's so they never reach the packaged app, and it builds to `website/build/` (git-ignored). It serves the app's own icons from `resources/icons/svg`. The root ESLint and stylelint configs ignore `website/`: its TypeScript is checked by its own `typecheck`, and its CSS sets Docusaurus's theme with literal colors, which the app's token rules (`21` §4.2) don't cover.

Reports is a renderer feature with an active tab, linked/effective filter state, and page-specific
saved-filter overrides in Pinia. Vue Query requests only the active report through the typed host
RPC. Pure report calculations live in `src/shared/reporting/`; the host reports service gathers
normalized Actual inputs in one serial read job and returns bounded aggregate DTOs, not the
transaction ledger (`03` §3, §8; `15` §7).

## 4. RPC between renderer and API host

- Transport: a `MessagePort` pair created by main. Main gives one end to the host (`utilityProcess.postMessage({ event: 'host:renderer-port' }, [port])`) and one end to the renderer (`webContents.postMessage('shell:hostPort', null, [port])`). A `MessagePort` can't cross `contextBridge`, so preload forwards it to the page with `window.postMessage({ type: 'app:host-port' }, '*', [port])`, and the renderer's `HostClient` (`renderer/rpc/host-client.ts`) picks it up. Main sends a fresh pair once each host start reports `host:ready`, and after every page load while the host is ready. A port sent to a host that is still starting would go unanswered, and the host also keeps a port that arrives before it's ready and attaches it once it is (otherwise a probe made right after launch hangs, then fails when the second port replaces the first). Calls made while there is no port wait for the next one; calls in flight on a port that is replaced fail and are retried by their caller.
- Protocol (JSON-serializable only):
  - request `{ id: number, method: string, params: unknown }` → response `{ id, ok: true, result } | { id, ok: false, error: { code: RpcErrorCode, message: string, details?: unknown } }`.
  - host → renderer events: `{ event: string, payload }`.
- The method map lives in `src/shared/rpc/host-api.ts` (`03` §8 lists every method): `hostMethods` holds each method's zod params schema, `HostResults` its result type, and `HostEvents` the event payloads. The renderer client derives its types from them: `host.call('transactions.update', {...})` is fully typed. The host validates params with the same schemas. `WRITE_METHODS` lists the methods that write; a host test sends each of them while offline and expects `offline`.
- Main-process services (`shell.*`: open file dialog, save dialog, print, settings get/set, open URL, set window title, show native context menu, `log` for renderer log entries, §8.1) are exposed by preload as `window.app.shell.*` via `ipcRenderer.invoke`.
- **Secrets in the renderer** are limited to `shell.secrets.available()` (is `safeStorage` usable, `19` §4), `shell.secrets.has(key)` and `shell.secrets.forget(key)`. There is no way to read a secret's value from the renderer. Storing secrets happens in the host, through the control channel (§4.1), driven by the `remember` flags on the session RPC methods (`03` §8).

### 4.1 Main ↔ host control channel

The host talks to main over the utility process's built-in `parentPort` (`process.parentPort` in the host, `child.on('message')` / `child.postMessage` in main). It's a small typed request/response protocol, defined as `ControlApi` in `src/shared/rpc/control-api.ts`, with the same `{ id, method, params }` → `{ id, ok, result | error }` shape as §4. Main validates params with zod.

| Direction | Methods / messages | Used for |
| --- | --- | --- |
| host → main | `secrets.get(key)`, `secrets.set(key, value)`, `secrets.delete(key)`, `secrets.clear(prefix?)` (every key, or every `server:` / `e2e:` key) | session tokens and encryption passwords (`03` §7, `19` §4); `clear` for a server change (`03` §7.2) |
| host → main | `settings.getApp()`, `settings.patchApp(patch)` | `serverUsers`, `recentBudgets`/`lastBudget` cleanup, server-change reset (`03` §7.1–7.2) |
| host → main | `settings.getBudget(cloudFileId)`, `settings.patchBudget(cloudFileId, patch)`, `settings.deleteBudget(cloudFileId)`, `settings.patchAllBudgets(patch)`, `settings.deleteAllBudgets()` | `localId`, `lastSyncAt` (`19` §2); user-switch cleanup (`03` §7.1); Clear Offline Cache (`03` §2); server change (`03` §7.2) |
| host → main | `shell.openExternal(url)`, `window.focus()` | the OpenID browser flow (`03` §7) |
| host → main | `connection:state`, `budget:opened` (copies of the renderer events), `job:slateWipe { phase: 'started' \| 'ended', backupPath }` | main's record of what to restore after a crash, and of an interrupted slate wipe (`03` §6.5) |
| host → main | `host:ready` (the host has started and can take the renderer's port), `log { at, level, source, message, data? }` | port hand-over and restore timing; main writes the single rotating log (`17` §8) |
| main → host | `log:level { debug }` (notification: the debug logging preference, sent when it changes and after every host start, §8.3) | logging (§8) |
| main → host | `host:renderer-port` (with the renderer's `MessagePort` attached) | §4 |
| main → host | `session:restore { serverUrl, cloudFileId?, localOnly }` (a request, sent once a restarted host is ready; the host replies when the reopen attempt has ended), `window:focus` (forwarded `browser-window-focus`), `app:quit` (run `shutdown()`, then reply) | crash recovery (`03` §6.5), background sync on focus (`03` §4.1), quit flow (`06` §5) |

Main applies the same rules to `shell.openExternal` from the host as from the renderer (`http:`/`https:` only, `02` §6). Settings changes made through the control channel are broadcast to the renderer like any other settings change (`19`).

## 5. Build & packaging

- `electron-builder` targets:
  - **Windows:** separate per-user NSIS installers for x64 and arm64. Each installer contains only its target architecture. MSI is optional.
  - **macOS:** DMG + zip (universal or separate x64/arm64), hardened runtime, notarization via `notarytool` (CI secrets).
  - **Linux:** AppImage, deb and rpm (x64 + arm64).
- **Native modules (checked against `@actual-app/api@26.10.0`):** the only native module is **`better-sqlite3@13.0.3`**. Its `.node` binary must be loaded from outside the asar archive.
  - It is an **N-API** addon (`NAPI_VERSION=10`, `node-addon-api`). Its binary is ABI-stable across Node and Electron, so **`@electron/rebuild` is not used**.
  - The npm tarball ships prebuilt binaries for `win32-x64/arm64`, `darwin-x64/arm64`, `linux-x64/arm64` and `linuxmusl-x64/arm64`, with no install script and no compile step. Packaging never compiles native code.
  - `allowScripts` in `package.json` MUST deny `better-sqlite3`. The tarball sets `gypfile: false`, but the lockfile does not record that field, so installing from the lockfile sees `binding.gyp` and runs `node-gyp rebuild`, which fails on a machine with no C++ toolchain. Denying the scripts keeps every install on the prebuilt binary.
  - `electron-builder.yml` MUST have `asarUnpack: ["node_modules/better-sqlite3/**/*.node"]`. Each target's `files` filter MAY exclude the other platforms' `prebuilds/*.node` to slim the installer.
  - The electron-vite host entry MUST mark `@actual-app/api` and `better-sqlite3` as **external** (not bundled), so the addon resolves from `node_modules` at run time. The API is loaded with a dynamic `import()` **after** `actual.ts` installs its fetch timeout wrapper, because the API reads `globalThis.fetch` once, at load (`03` §3). A lint rule forbids static imports of `@actual-app/api`.
  - The Electron version MUST bundle **Node ≥ 22.14** (the minimum for N-API 10).
  - Whenever `@actual-app/api` is upgraded, re-check its tree (`find node_modules -name binding.gyp -o -name '*.node'`) and update this list.
  - CI still packages on each OS (signing and notarization need it), but no OS needs a native toolchain.
- The API host bundle is a separate Vite entry (`out/host/index.js`) launched with `utilityProcess.fork(path)`.
- `dependencies` in `package.json` are only what main, preload and the host load from `node_modules` at run time (`@actual-app/api`, `zod`, `date-fns`). Everything the renderer uses is a `devDependency`, because Vite bundles it into `out/renderer`. Otherwise electron-builder would ship those packages again, and their own dependencies with them (Pinia's devtools pull in Vite and esbuild).
- App id `com.actuality.app` (placeholder). The protocol and file associations (`.ofx`, `.qfx`, `.qif`, `.csv`) are optional and off by default (`19` §1 `fileAssociations`).
- Auto-update: out of scope (D8). The electron-builder config keeps a `publish` section ready.
- CI: GitHub Actions, as in §5.1.

### 5.1 Checks: scripts, hooks and CI

electron-vite builds with Vite (Rolldown and Oxc), which strip types without checking them, and plain `tsc` doesn't read `.vue` files. So type checking is its own step, and `build` runs it first.

**Scripts** (`package.json`):

| Script | Runs |
| --- | --- |
| `typecheck` | `vue-tsc --build` over the three TypeScript projects: `tsconfig.node.json` (main, host, shared, scripts, tests, configs), `tsconfig.preload.json` (preload, shared; Node and DOM types, because preload forwards a DOM `MessagePort`) and `tsconfig.web.json` (renderer, shared). Incremental (`.tsbuildinfo`), declaration-only output in `node_modules/.cache`. |
| `dev` | `install-electron` (Electron has no install script and downloads its binary on first use, but `electron-vite` only looks for it, and fails if it is missing; no-op once downloaded), generates the `en-XA` pseudo-locale (`20` §3.6), then `electron-vite dev` |
| `start` | `install-electron`, then `electron-vite preview` |
| `lint` | `eslint. --max-warnings 0 --cache --report-unused-disable-directives` |
| `lint:css` | `stylelint "src/**/*.{css,vue}" --max-warnings 0` |
| `format:check` | `prettier --check.` |
| `deadcode` | `knip` |
| `docs:check` | `markdownlint-cli2` on `docs/**/*.md` and `website/docs/**/*.md`, then `tsx scripts/docs-check.ts` on `docs/` (`21` §4.5) |
| `docs:sync` | `tsx scripts/docs-sync.ts [base] [head]`: the spec, user guide and UI strings stay in step across a range of commits (`21` §4.5) |
| `docs:site` / `docs:site:build` | the user guide site (§3): the Docusaurus dev server / its typecheck, then `docusaurus build` into `website/build/`. Run `npm --prefix website ci` first. |
| `check` | `format:check`, `lint`, `lint:css`, `typecheck`, `i18n:check` (`20` §3.7), `deadcode`, `docs:check`, in that order, stopping at the first failure |
| `build` | `typecheck`, then `electron-vite build`. A type error fails the build. |
| `test` / `test:int` / `test:e2e` | unit and component (Vitest) / integration (`21` §1) / `build`, then E2E (Playwright), because `dev` leaves `out/` without a renderer |

**Git hooks** (installed by `simple-git-hooks` on `npm install`; `lint-staged` for staged files):

- **pre-commit:** on staged files, `eslint --fix --max-warnings 0 --no-warn-ignored` (staged files that ESLint ignores, such as `*.d.ts`, are skipped without a warning), `prettier --write`, `stylelint --fix` (on `src/`, as `lint:css`) and (for Markdown) `markdownlint-cli2 --fix`; then `typecheck` (incremental, so normally a few seconds). `lint-staged` runs with `--max-arg-length 4096`, because its Windows default of 8191 leaves no room for what the `.cmd` shims add, and a commit with many files would fail with "The command line is too long." The commit is refused on any error.
- **commit-msg:** `commitlint --edit` (`21` §4.6).
- **pre-push:** `check`, then `test`, then `docs:sync` from `origin/main` to `HEAD` (`21` §4.5).

Hooks can be skipped with `--no-verify`, so they're a convenience, not the gate. CI is the gate.

**CI** (GitHub Actions). Every job starts with `npm ci` against the lockfile, using the Node version in `.nvmrc` (also `engines.node` in `package.json`). Jobs stop at the first failing step.

| Job | Runs on | Steps | When |
| --- | --- | --- | --- |
| `check` | ubuntu-latest | `check` (format, lint, stylelint, typecheck, i18n, dead code, docs); on pull requests also `commitlint --from <base> --to HEAD`, `docs:sync` from base to head (`21` §4.5) and a check of the pull request title (`21` §4.6) | every push and pull request |
| `test` | windows-latest, macos-latest, ubuntu-latest | `test` | every push and pull request, after `check` |
| `integration` | ubuntu-latest | `test:int` against the Docker test server matrix (`21` §1) | every push and pull request, after `check` |
| `build` | windows-latest, macos-latest, ubuntu-latest | `build`, then package (`electron-builder`) | every push and pull request, after `check` |
| `website` | ubuntu-latest | in `website/`: `npm ci`, `typecheck`, `build` (broken links and anchors fail it) | every push and pull request, after `check` |
| `e2e` | ubuntu-latest (smoke on windows and macos) | `test:e2e` on the packaged app, including the axe, keyboard-only, zoom and target-size suites (`22` §7) | nightly and before release (`21` §1) |
| `build`, `deploy` (`docs-deploy.yml`) | ubuntu-latest | in `website/`: `npm ci`, `build`; then publish `website/build/` to GitHub Pages at `https://actualitydesktop.org` | pushes to `main` that change the site, its icons or the Node version, and on demand |

**Branch protection on `main`:** pull requests only, and `check`, `test`, `integration`, `build` and `website` must pass before merging. No direct pushes, and no bypass for administrators.

## 6. Security

- CSP in `index.html`: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'`. External links open in the OS browser via `shell.openExternal` (http/https only).
- `webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`. Block navigation away from the app origin.
- The server password and encryption passwords never reach the renderer after entry. The renderer sends them once to the host over the relevant RPC (server connection, encrypted-budget open, or key generation). The **server password is never stored**. The host exchanges it for a session token (`03` §7) and, if "Stay signed in" is ticked, hands **that token** to main over the control channel (§4.1), and main stores it with safeStorage. Encryption passwords are stored the same way if "Remember" is ticked (`19` §4). No secret value is ever sent back to the renderer.
- Self-signed TLS: Preferences → "Trust this certificate file…" stores `extraCaCertPath` (`19` §1). Main passes it as `NODE_EXTRA_CA_CERTS` in the host's environment when it spawns the host, so it takes effect when Actuality restarts. **Restart now** runs the quit flow (`06` §5) and then `app.relaunch()`. Under `npm run dev` it only quits: the page comes from electron-vite's dev server, which stops with the first process, so a relaunched copy would open a blank window. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`. The setting doesn't reach the OS browser: an OpenID sign-in passes through `{server}/openid/callback` in the browser, so a self-signed certificate must also be trusted by the OS or browser (`03` §7). Trusting a certificate does not fix one whose subjectAltName doesn't list the server's address. Node still rejects it (`ERR_TLS_CERT_ALTNAME_INVALID`). The connection diagnosis in `03` §9.1 tells the user which case they hit.

## 7. Cross-platform specifics

| Topic | Windows / Linux | macOS |
| --- | --- | --- |
| Menu | menu bar on the window (`06` §4) | app menu + standard Window menu |
| Delete key in register | Delete | Backspace (and Delete) |
| Preferences | File ▸ Preferences… (Ctrl+) | App menu ▸ Settings… (⌘) |
| Quit | File ▸ Exit | App menu ▸ Quit (⌘Q) |
| About | Help ▸ About | App menu ▸ About |
| Full screen | View ▸ Toggle Full Screen (F11) | View ▸ Toggle Full Screen (Ctrl+Cmd+F) |
| Window close | quits the app | quits the app too (single-window app; standard behavior) |

## 8. Logging and debug logging

Logging is a **cross-cutting concern**. Business code (services, stores, components, parsers) doesn't call a logger. Logging is written once, as small **aspects**, and **woven** around the join points listed in §8.2 where each process is assembled. The rest of the app stays unaware of it, and turning debug logging on or off changes no behavior.

### 8.1 Levels, file and format

- One file, `{userData}/logs/app.log`, rotating 5 × 1 MB (`17` §8). **Main is the only writer.** The host sends its entries over the control channel (§4.1), and the renderer sends its entries to main with `shell.log(entry)` (one-way, never awaited). Entries from the other two processes keep their `source` (`'host'` or `'renderer'`).
- Levels: `error`, `warn`, `info`, `debug`. The file always records `info` and above. It records `debug` only while **Preferences ▸ Diagnostics ▸ "Enable debug logging"** is on (`debugLogging`, `19` §1, `07` §7). The 5 MB rotation cap applies either way, so debug logging can't fill the disk.
- Line format (unchanged): `{ISO time} {LEVEL} [{source}] {message} {json data}`. `message` is a stable event name in dotted lowercase (`rpc.call`, `queue.job`, `http.request`, `conn.state`), and everything variable goes in `data`, so the log can be searched and diffed.
- Direct `console.*` is forbidden (`21` §4.1). Before the sink is ready, a process's entries go to stderr.

### 8.2 Aspects and join points

An aspect is a function that receives the call's description (`name`, `process`, `callId`, argument **shape**) and may run code **before**, **after returning**, **after throwing** and **around** the call (to time it). Aspects never read or change arguments or return values, never swallow or replace an error (it is rethrown unchanged, and the call's timing semantics are not altered), and never throw: a failure inside an aspect is dropped, like a failure of the sink (`host/log.ts`).

In code (`shared/aspects/weave.ts`) an aspect is `(joinPoint) => advice | undefined`: its body is the before advice, and it returns the after-returning and after-throwing advice, which get the duration (the around timing). One that returns nothing costs nothing more, so a debug aspect returns at once while the level is off. The join point hands out shapes and **facts** only on request: facts are the primitive values a join point chooses to expose (a job's queue depth and wait time, a request's method, path and status), declared where the join point is woven, never in the woven code.

Three kinds of join point:

- **Calls**, woven with `advise` or `weave` (the table's rows).
- **Fallible steps**: `step(name, fn)` (`shared/aspects/steps.ts`) marks a piece of work whose failure its caller handles itself: it carries on, falls back, or rethrows (saving `lastSyncAt`, a session start task, renaming an imported budget, the quit flow's steps). The composition root weaves the steps once per process (`weaveSteps`), so a failure is logged as `step.failed` (`warn`, with the step's name and the error's code, §8.4) without the caller logging it. These replace the `try { … } catch (e) { log.warn(…) }` blocks.
- **Events** that aren't calls (a state transition, a timed-out job that settles later): the woven module exposes a hook (`onTransition`, `onLateSettle`, `onInvalidNote`), and the composition root connects it to aspects with `announce(name, process, aspects)`.

| Join point | Woven at | Always on (`info` and above) | Debug only |
| --- | --- | --- | --- |
| Host RPC method (`03` §8) | the dispatcher that maps `hostMethods` to services (`host/dispatch.ts`) | an error result: `rpc.error` with the code, and the message only for our own `RpcError` (`warn`; `error` for `internal`) | `rpc.call` on entry (method, `callId`, param shape) and on exit (`ok` or the error code, duration, result shape) |
| Host queue job (`03` §3) | `host/queue.ts`, around each job | a job that waited or ran longer than 5 s (`queue.slow`), a job timeout (`queue.timeout`) | `queue.job`: name, queue depth, wait time, run time, outcome |
| HTTP to the server (`03` §3) | around `globalThis.fetch`, outside the timeout wrapper (`host/fetch-timeout.ts`) | slow requests, timeouts and resends (`http.slow`, `http.timeout`, `http.resend`, as today) | `http.request`: method, path (no query string), status, duration, `callId` |
| Connection state machine (`03` §4) | `host/connection.ts`, on each transition | the transition (`conn.state`: from, to, reason) | — |
| Control channel (§4.1) | both ends of `ControlApi` | a rejected request | `control.call`: method, duration, outcome |
| `shell.*` IPC handlers | `main/` where the handlers are registered | a handler that throws | `shell.call`: channel, duration, outcome |
| Host client (`renderer/rpc/host-client.ts`) | the client's `call` | — (the host already logged the error as `rpc.error`; the UI shows it) | `rpc.call`: method, `callId`, duration, outcome |
| Lifecycle (host start, exit, restart, quit) | `host-supervisor.ts` and the quit flow | the event (`app.start`, `host.start`, `host.status`, `host.exit`, `app.quit`, `log.level`) and the host's stderr | `host.stdout`: the Actual API's own progress messages |
| Fallible steps | `step()`, woven by each composition root | a failure (`step.failed`) | — |
| The Actual API object (`03` §3) | `host/index.ts`, around the `ActualApi` object | a missing internal handler (`api.unavailable`) | — |
| Data the host reads as empty or shows apart | hooks on `MetadataRepository` and `BudgetService` | an invalid reserved note (`metadata.invalidNote`, `04` §5.3), a month whose header identity doesn't hold (`budget.otherAdjustments`, `09` §2) (`warn`) | — |
| A timed-out job that settles later (`03` §3) | the queue's `onLateSettle` hook | `queue.lateSettle` with `ok` | — |
| Unhandled errors and rejections | one handler per process | the error (`error`) | — |

The `callId` is the RPC request id. The host keeps it in an `AsyncLocalStorage` for the length of the job, so `queue.job` and `http.request` entries carry the id of the renderer call that caused them. One debug trace then follows a click through the renderer, the host and the server. The renderer's host client numbers its requests itself (`HostClient.request(id, method, params)`, the woven join point), so the ids stay unique across host restarts and the renderer's `rpc.call` carries the same id as the host's entries.

Events that are neither a failure nor a transition (carryover extended to new months, the previous user's cached budgets removed, an automatic retry that found the server still unreachable) have no `info` entry: a debug trace shows the calls behind them. A sync that ends with an error that changes no state is the `conn.state` transition from `Syncing` back to `Online`, with the error as its `reason`.

### 8.3 Switching it on and off

1. The checkbox writes `debugLogging` through `shell.settings.set` (a renderer-writable key).
2. Main applies it at once to its own level, and sends `log:level { debug: boolean }` to the host over the control channel. It sends the current level again after every host start (`host:ready`), so a restarted host never reverts to the default. The renderer reads the setting from `useSettings()` like any other, so it sees the change in the usual settings broadcast.
3. Each process keeps the level in one module-level flag that the aspects read. When it is off, a debug advice returns before it builds anything: no argument shape, no JSON, no timer, no entry. Aspects that run at `info` and above don't depend on the flag.
4. Main drops a `debug` entry it receives while the flag is off, whichever process sent it. This covers the short gap while a change is still on its way to the host or the renderer.
5. The setting persists, so debug logging stays on across launches until it is switched off. Switching it on or off writes one `info` entry (`log.level`) so the file shows when it was on.

### 8.4 What is logged, and what never is

- Debug entries describe **what happened and how long it took**: event names, ids, counts, durations, status codes, error codes and the shape of parameters and results (the top-level key names, and array lengths).
- **Never logged at any level:** passwords, session tokens, encryption passwords, certificate contents, request or response bodies, headers, cookies, query strings, and budget content (payees, amounts, notes, notes, account or category names, file contents). Local paths show `~` in place of the home folder.
- **Error messages and stacks:** a failed call or step logs the error's **code** (and its class name when it isn't a plain `Error`). The message is logged only when the error is our own `RpcError`, whose texts are fixed strings from `20-strings.md`. Messages from Actual, the server or Node can carry payee or category names, so they are never logged by the aspects (`safeError` in `shared/aspects/log-entry.ts`). When debug logging is on, exception entries also include stack frames; the stack's first line is omitted because it contains the exception message. With debug logging off, no stack is recorded. The error boundaries log the message of an uncaught exception, which is our code's.
- **Unhandled rejections in main:** main registers `unhandledRejection` to log it, which replaces Node's default warning printed to the console for such a rejection, so it goes to the log file. `uncaughtException` is only monitored, so Electron's own handling stays.
- A **redaction step** sits in the sink, as the last aspect before the write. It replaces the value of any key matching `/pass(word)?|token|secret|authorization|cookie|key/i` with `"[redacted]"` (at any depth, down to 6 levels), and cuts any string over 500 characters. It is a safety net: the aspects aren't meant to pass such values, and a test fails when one gets through (§8.6).

### 8.5 Where the code lives

- `src/shared/aspects/` (pure TS): `advise(fn, meta, aspects)` wraps a function, and `weave(object, meta, aspects)` wraps every method of a service object with a `Proxy`. Both handle sync and async calls, and are the only weaving mechanism (no decorator library, no code generation), with `announce` for events and `step`/`weaveSteps` for fallible steps. It also holds the level flag (`level.ts`), the redaction function (`redact.ts`), the shape function (`shape.ts`), the `LogEntry` type with `describeError`, and the logging aspects written once against a `Write` sink (`logging.ts`: `rpcLogging`, `queueLogging`, `httpLogging`, `handlerLogging`, `stepLogging`, `eventLogging`, …).
- Each process instantiates the aspects it weaves on its own sink, next to its composition root (`host/aspects/`, `main/aspects/`, `renderer/aspects/`), and weaves them there: `host/index.ts`, `main/index.ts` and `renderer/main.ts`. A module that is woven never imports a logger.
- `main/log.ts` stays the one place that writes the file, with the debug drop and the redaction; `host/log.ts` forwards to main over the control channel and `renderer/log.ts` with `shell.log`. A logger import outside an aspect, the sink or an error boundary (the three composition roots) fails lint (`21` §4.1). Business code makes no direct `log.*` calls; aspects, steps and hooks do the logging.

### 8.6 Tests

- Unit (`shared/aspects`): advice order for sync and async calls; an error is rethrown unchanged; an aspect that throws doesn't affect the call; with the level off, a debug aspect does no work (a spy on the shape function is never called); redaction of nested keys and long strings; exception stack frames appear only with debug logging and omit the message-bearing first line.
- Unit (host and main): `log:level` is sent on change and again after a host restart; main drops a `debug` entry while the flag is off; the dispatcher logs `rpc.call` exactly once per method, in debug only.
- Component: the Diagnostics checkbox shows the saved value, writes `debugLogging`, and is reachable by keyboard (`22`).
- E2E: with the setting off, a journey writes no `DEBUG` lines. After ticking the box, an RPC call produces `rpc.call`, `queue.job` and `http.request` lines with the same `callId`. A **canary** check greps the whole log, after a debug-on journey that signs in, for the test password, the session token and the budget's payee names, and fails when any is found.
