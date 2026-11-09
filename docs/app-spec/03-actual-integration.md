# 03 — Actual Server Integration (API Host, Sync, Write Gate, Offline)

This chapter defines the boundary between the app and Actual. Everything here runs in the **API host** (`02` §1) unless noted otherwise.

## 1. Facts about `@actual-app/api` that shape the design

From the Actual API docs:

- It is a **Node library**, not an HTTP API. The client holds a **local copy** of the budget (`dataDir`, one subdirectory per budget) and syncs CRDT changes with the server. "The server does not have the functionality for analyzing details of or modifying your budget": all queries and calculations run in the client.
- `init({ dataDir, serverURL, password, verbose })` → connect. With no `serverURL`, it runs local-only and can only open already-downloaded budgets.
- `downloadBudget(syncId, { password? })` loads the budget. It uses the local copy if one exists, otherwise downloads it. `password` is the end-to-end encryption password.
- `loadBudget(localId)` opens a locally cached budget by local id. `getBudgets()` lists local and remote files (`BudgetFile`: `name`, `cloudFileId`, `groupId`, `hasKey`, `encryptKeyId?`, `state?` = "remote", `id?` = local id).
- `sync()` pushes and pulls changes. `shutdown()` closes the budget.
- Errors carry `code` for common failures: `network-failure`, `network`, `invalid-password`, `token-expired`, `unauthorized`, `budget-not-found`, `missing-key`, `decrypt-failure`, `old-key-style`, `out-of-sync-migrations`, and `file-has-reset` (§9). Other errors have only `message`.
- Amounts are integers in minor units. Dates are `YYYY-MM-DD`, months are `YYYY-MM`. Ids are UUIDs.
- `aqlQuery(q(...))` runs ActualQL (`04` §6). (`runQuery` is deprecated in 26.x, so the app never uses it.) `batchBudgetUpdates(fn)` groups budget-amount changes.

## 2. Cache directory ("items may be cached locally")

- `dataDir` = `{userData}/actual-cache/`. This is the **only** budget data on disk. It is a cache owned by the API, not an app database: the app never opens its SQLite files directly.
- Preferences (`07` §7) shows its location and has **Clear Offline Cache…** (`session.clearCache`: closes the budget, deletes the folder, removes `localId` and `lastSyncAt` from every budget's device settings through the control channel so nothing points at a deleted copy, then returns to the budget list). With the app preference `clearCacheOnExit` (default **off**) the folder is deleted on quit. This is allowed only when there are no unsynced changes (§5.4). Otherwise the user is asked first.
- The app's own per-device settings are JSON files (`19`), not a database.

## 3. API host structure

```text
host/
  actual.ts      — the only module importing '@actual-app/api'; exposes typed wrappers
  queue.ts       — serial FIFO job queue: run<T>(label, fn, {kind: 'read'|'write'|'sync'})
  connection.ts  — connection state machine (§4), health checks, write gate (§5)
  services/*.ts  — business operations composed of API calls (each one job)
  index.ts       — RPC dispatch: validate params (zod) → service → result/error mapping
```

- **Serial queue:** every API call runs inside a queue job, so two API calls never interleave. A service operation that makes several API calls (e.g. committing a split with a transfer) runs as **one job**. Reads and writes share the queue. Reads are fast, and correctness beats throughput. Jobs have a timeout:
  - default **60 s**;
  - **3 min** for opening a budget (`session.openBudget`), for a re-init retry (§4.2) and for creating a budget (`budgetFile.create`, `07` §4). These download or upload the budget, and the fetch wrapper below allows 120 s for that;
  - **10 min** for import, plus the bulk allowance below for tagging matched rows;
  - **bulk jobs:** any job that updates or deletes transactions one by one through the settling wrapper below (about 60 ms each) gets its normal timeout **+ 100 ms per transaction it touches**. These are bulk register actions on a selection (`transactions.setCleared`, `approve`, `categorize`, `delete`, `undo`, `moveToAccount`), `reconcile.finish`, `payees.rename` / `combine` / `applyRenameRules`, the import's review tagging, and the slate wipe (`18` §2: 10 min + 100 ms per transaction). Bulk jobs that touch more than 200 transactions report `job:progress` (§8), and the renderer shows the loading overlay (`17` §6).

  Every job timeout is longer than the fetch timeouts its requests can hit, so a slow or dead server ends as `network-failure`, never as a job timeout. On a job timeout:
  - **Only `session.connect`, `session.openBudget` and the re-init retry (§4.2)**, the jobs that run `init`/`downloadBudget`, mark the connection `Error`, because the API's state is then unknown.
  - Every other job just fails its own call with `timeout`. The renderer shows the "Something went wrong" TaskDialog (§9), the state is unchanged, and the queue continues with the next job. This includes a settling-wrapper timeout (below), which ends its job with `timeout`.
  - An API call can't be cancelled, so after a timeout the queue still waits for the timed-out job's pending API call to settle before it starts the next job. API calls therefore never interleave, even after a timeout. The caller gets its `timeout` error straight away.
  - An abandoned write may still succeed. When the pending call settles, the host emits `data:changed` for that job's tables, so the UI shows what was actually written.
  - If the pending call hasn't settled **60 s** after the timeout, the host is stuck. It logs the job and exits, and main restarts it through the crash recovery in §6.5.
- **Fetch timeouts.** `@actual-app/api` sets **no timeout** on any server request. A server that accepts connections but never answers can leave `init()` pending, and undici only gives up after 300 s. A hung `sync()` also catches every later `sync()`, because `fullSync` is shared (`once`), and blocks `shutdown()`, which syncs first. The API reads `globalThis.fetch` **once, when the module is loaded** (`var fetch$1 = globalThis.fetch`).
  - So `actual.ts` MUST install a fetch wrapper **before** it first imports `@actual-app/api`. The host entry must load the API with a dynamic `import()` after the wrapper is in place, and nothing may import it earlier.
  - The wrapper adds `AbortSignal.timeout(ms)`, combined with any caller signal through `AbortSignal.any`. Timeouts:
    - **120 s** for `/download-user-file` and `/upload-user-file`;
    - **15 s** for everything else (sync, login, validate, list files, keys).
  - On timeout the API reports a normal **`network-failure`**. The state machine (§4) needs no hang-specific handling.
  - **One resend after a reset socket:** after a long write job with no network traffic (a slate wipe, about 1,400 messages), the first sync push can fail with `ECONNRESET` on a reused keep-alive connection, while the same push sent again at once succeeds. When `fetch` rejects with cause `ECONNRESET` before any response, and the body can be sent again (none, a string or bytes), the wrapper sends the request once more and logs it (method and path, never the body), so a server that resets often stays visible. Resending a sync push is safe: Actual's messages are CRDT operations, applied once. The resend applies to the other requests with a replayable body too (login, validate, list files and downloads): a socket reset before any response means the server most likely never handled it, and a login or read repeated is harmless. **Uploads (`upload-user-file`) are never resent**: the server may have stored the file before the reset, and a repeat isn't idempotent by design. A one-shot stream body isn't resent. Other errors aren't retried.
  - Apart from that one resend, the wrapper only adds a signal. It never rewrites requests or responses, and it logs the method, path and duration of slow requests (> 5 s).
- **Event subscription.** `on()` adds handlers to a module-level emitter that `init()` and `shutdown()` never clear. Handlers from every earlier session keep firing. `actual.ts` subscribes **once per host process**, at the first successful `init`, and never again on re-init.
- **Write settlement:** in `@actual-app/api` 26.11.0, `deleteTransaction` **resolves before its write lands**. The handler doesn't await the batch update, and returns `undefined` despite its declared types. A read straight afterwards can see the old row. `updateTransaction` awaits its batch update; its wrapper polls the same way, which then succeeds on the first read. The other write methods the app uses (`addTransactions`, `updateAccount`, budget setters) do await.
  - The host therefore writes through the internal `transactions-batch-update` (table below), which is awaited and needs no polling. The settling wrappers stay as its fallback.
  - So the `actual.ts` wrappers for these two methods MUST NOT resolve until the effect is visible. They poll the transaction by id every 10 ms, for up to 3 s:
    - After an update: until every scalar field written has the written value.
    - After a delete: until the row is gone.
    - For a subtransactions update: until the child id set and amounts match.
  - Then, if the transaction is or was a transfer side, they also wait until the other side shows the propagated `amount`, or is gone after a delete.
  - Fields that Actual itself rewrites are excluded from the "until" check. Examples are a category cleared on an on↔on transfer, or a category cleared on a move off-budget (`04` §3).
  - A wrapper that times out rejects with `timeout`.
  - This keeps the rule "a finished job means the data is written", which the gate (§5), the post-write sync (§5.2) and `data:changed` depend on.
  - Integration tests measured a median settle time of 57 ms (max 79 ms) against server 26.2.0.
  - Re-check this whenever `@actual-app/api` is upgraded. If the handler starts awaiting, the polling becomes a no-op.
- **Internal handlers:** the public API is missing a few operations, so `actual.ts` uses these **internal** handlers through the `send` function returned by `init()`:

  | Handler | Params | Used for | Fallback if unavailable |
  | --- | --- | --- | --- |
  | `category-move` | `{ id, groupId, targetId }` | category drag-and-drop, and putting new categories at the end of their group | cross-group moves only, via `updateCategory({ name, group_id })` (unspecified position). Reorder drops are refused with the TaskDialog "This version of Actual doesn't let Actuality reorder categories." (**Ok**). |
  | `category-group-move` | `{ id, targetId }` | group drag-and-drop | group reordering disabled |
  | `schedule/get-upcoming-dates` | `{ config, count }` → `ISODate[]` | occurrence dates: the Schedule dialog's upcoming dates and its "no upcoming dates" check, Make recurring, Quick Budget (`12` §1, §3.1, §4, §5) | only `next_date` is known. The dialog hides its upcoming dates and skips the check; Quick Budget counts one occurrence; Make recurring starts on the transaction's date + 1 month. |
  | `make-filters-from-conditions` | `{ conditions }` → `{ filters }` (ActualQL filters, run with the public `aqlQuery`) | the Schedule dialog's **Find matching transactions** (`12` §3.1): Actual's own matching of a schedule's conditions, recurring dates within 2 days of each occurrence included, so the app does no date math | the Find matching list shows "This version of Actual can't search for matching transactions." |
  | `rule-apply-actions` | `{ transactions, actions }`: whole rows (`select('*')`) → null when Actual can't read an action | the rule editor's **Apply Actions** (`23` §3.4). The `make-filters-from-conditions` row above also lists the rule editor's matching transactions. | Apply Actions fails with "Something went wrong"; the matching list shows "Actual can't list matching transactions." when `make-filters-from-conditions` is missing |
  | `schedule/skip-next-date` | `{ id }` | **Skip this payment**, and advancing after **Enter in register now** (`12` §3) | Skip is disabled. Enter now deletes Once schedules only, and recurring ones advance when Actual's service next runs. |
  | `save-prefs` | `{ budgetName }` | renaming the **open** budget in Budget Properties, and the duplicate-name rename after an import (`07` §3.4, §4). It calls the server's `/update-user-filename` and also syncs the name. | the name is read-only, with a tooltip; an import keeps its original name |
  | `tags-discover` | `{}` | the Tags manager's **Discover** (`04` §5.2): entities for the tags already used in notes | Discover fails with "Something went wrong" |
  | `tags-rename` | `{ id, tag }` | renaming a tag in the Tags manager (`04` §5.2). The public `updateTag({ tag })` renames only the entity and leaves the old hashtag in every note (26.11.0, covered by an integration test); this handler also rewrites that exact, case-sensitive hashtag in every transaction's notes. | Rename fails with "Something went wrong"; colors and descriptions still change through the public `updateTag` |
  | `delete-budget` | `{ id }`: the **local** id only, never a `cloudFileId` | the user switch (§7.1): deleting another user's cached copies, which the app may not do by touching `actual-cache/` itself. With only `id` the handler deletes the local files; a `cloudFileId` would delete the server copy too. | none: the switch can't keep another user's data, so it fails with "Something went wrong" |
  | `transactions-batch-update` | `{ added, updated, deleted, runTransfers: true }`: rows as Actual stores them | every transaction update and delete (`11` §6, `10` §6, §8). The public `deleteTransaction` starts this batch **without awaiting it, so its tail runs outside Actual's write queue** (26.11.0), and that tail (transfer upkeep, orphan-payee cleanup) can overlap the next call, which then never returns. Through `send` it runs in the queue and resolves when everything is written, transfers included. The host builds the rows the public method would: a split's lines take the parent's date, account and cleared state (and its payee unless they're transfers); an empty line list turns the split back into a normal transaction; deleting a split's last line clears the parent's `is_parent`. | the public methods with the settling wrappers below |

  For the move handlers, `targetId` means "insert before this one", and `null` means "append at the end".

  Rules:
  - The handlers in this table are the **only** internal handlers the app may call. `save-prefs` may only be called with the single key `budgetName`, and `delete-budget` only with a local `id` (the user switch of §7.1 needs it, and the cache folder belongs to the API). Budget creation, import and export use the **public** `runImport`, `importBudget` and `exportBudget`. The app doesn't delete server budgets; only the test harness calls `delete-budget` with a `cloudFileId` (`21` §2). They are typed in `actual.ts`, used nowhere else, and covered by an integration test (`21` §1) that runs on every `@actual-app/api` upgrade.
  - If a call fails because the handler is missing or its signature changed, the wrapper reports `actual` with `details.code = 'internal-handler-unavailable'`, and the UI uses the fallback above.
  - The app does **not** call Actual's schedule service (`schedule/force-run-service`) or `schedule/post-transaction`. The service runs by itself after sync (`12` §2).
  - Accounts don't need this: `updateAccount({ sort_order })` is public and works (`04` §3).
- **Single budget:** opening another budget runs `shutdown()` (unsynced-change check first, §5.4), then `init` + `downloadBudget`.

## 4. Connection state machine

| From | Event | To |
| --- | --- | --- |
| `Disconnected` | `session.connect` / `connectOpenId` succeeds, or startup with a stored token (`07` §1) | `SignedIn` |
| `Disconnected` | startup without a stored token, server reachable (`07` §1) | `AuthRequired` |
| `Disconnected` | startup (or a crash-recovery reopen, §6.5) with the server unreachable (the login-method probe or the token `init` fails with a network error), and the budget to open has a local copy → local-only `init` + `loadBudget` (§6.2). A stored token isn't needed. | `OfflineReadOnly` (local-only session) |
| `Disconnected` | startup with the server unreachable and no budget to open offline (no `lastBudget`, `openLastBudgetOnStartup` off, or no local copy) | `Disconnected` (Budget List in its "Can't reach…" state, §6.2) |
| `SignedIn` | `session.openBudget` | `Connecting` |
| `SignedIn`, or any state with a budget open | `session.forgetServer` (change server, §7.2) or `session.signOut` (§7.3), after closing the budget | `Disconnected` |
| `Connecting` | `init` + `downloadBudget` + `sync` ok | `Online` |
| `Connecting` | network error, local copy exists → local-only `init` + `loadBudget` (§6.2) | `OfflineReadOnly` |
| `Connecting` | network error, no local copy | `SignedIn` (Budget List shows "Can't reach…", §6.2) |
| `Online` | a `sync` starts (ours or Actual's automatic one, §4.1) | `Syncing` |
| `Syncing` | sync ok | `Online` |
| `Online` / `Syncing` | network error (sync event, gate sync, post-write sync) | `OfflineReadOnly` |
| `OfflineReadOnly` | reachability probe answers (§4.2) | `Reconnecting` |
| `Reconnecting` | retry ok | `Online` |
| `Reconnecting` | retry fails with a network error | `OfflineReadOnly` |
| `OfflineReadOnly` (local-only session) | the reachability probe answers, but there's no session token in host memory (the app started offline without a stored token) | `AuthRequired` (§4.2); no retry job is queued |
| `Connecting`, `Online`, `Syncing`, `Reconnecting`, `SignedIn` | `invalid-password`, `token-expired`, `unauthorized` | `AuthRequired` |
| `AuthRequired` | signed in again (§6.3) | the state it came from, re-inited with the new token: `SignedIn` without a budget; `Connecting` again if a budget was being opened (the open resumes); with a budget open, a server-session re-init then `Online`. The encryption password is taken from host memory (§7), so the user isn't asked again. |
| `AuthRequired` | Cancel, with a budget open | keep the budget open **read-only**: `OfflineReadOnly`, with the banner "You're signed out of your Actual server. Your budget is shown as of {last sync time} and can't be changed until you sign in." and **Sign in**. Automatic retries pause. **Sign in** (or **Retry now**) shows the modal again. |
| `AuthRequired` | Cancel, no budget open | `Disconnected` → Connect screen with the address filled in |
| `Online`, `Syncing`, `OfflineReadOnly` (server session) | close budget (§5.4 check) | `SignedIn` |
| `OfflineReadOnly` (signed out: sign-in was cancelled, no valid token) | close budget (§5.4 check) | `Disconnected` → Connect screen with the address filled in |
| `OfflineReadOnly` (local-only session) | close budget | `Disconnected` → Budget List in its "Can't reach…" state (§6.2) |
| any | `decrypt-failure`, `out-of-sync-migrations`, `file-has-reset` (§9), a timeout of a job that runs `init`/`downloadBudget` (`session.connect`, `session.openBudget`, the re-init retry; §3) | `Error` |
| any | host crash or stuck host (§3); main restarts the host | the state is restored by the automatic reopen (§6.5); the renderer shows "Reconnecting…" meanwhile |
| `Error` | TaskDialog dismissed (or **Close budget** for `file-has-reset`) | `SignedIn` (or `Disconnected` if not signed in) → Budget List |
| `Error` (`file-has-reset`) | **Download again** (§9) | `Connecting` |

| State | Meaning | UI (`08` §2.4 indicator, `06` §2 banner) | Writes |
| --- | --- | --- | --- |
| `Disconnected` | no server session | Connect screen, or the Budget List in its "Can't reach…" state | n/a |
| `SignedIn` | signed in to the server (token `init` done), no budget open | Budget List, Open Budget, Budget Setup | n/a (budget creation and import are allowed, `06` §4) |
| `Connecting` | `init` + `downloadBudget` in progress | Loading screen | n/a |
| `Online` | last contact with the server succeeded | indicator "Connected" | **allowed** |
| `Syncing` | a sync is running: one of the host's `sync()` jobs, or Actual's own automatic sync (§4.1) | indicator spinning | allowed (queued) |
| `OfflineReadOnly` | server unreachable; showing the cached budget | yellow banner "Can't reach your Actual server. Your budget is shown as of {last sync time} and can't be changed until the connection is restored." + **Retry now** | **blocked** |
| `Reconnecting` | the reachability probe answered, and the retry job (§4.2) is running | banner text "Reconnecting…" | blocked |
| `AuthRequired` | `invalid-password`, `token-expired`, `unauthorized`, or no stored token at startup | modal "Sign in to your Actual server" (§6.3), over the open budget or the Budget List | blocked |
| `Error` | unrecoverable for this session | TaskDialog with message, then the Budget List. For `file-has-reset` the budget stays visible, read-only, behind the dialog (§9). | blocked |

Events to the renderer: `connection:state` `{ state, lastSyncAt, unsyncedChanges: boolean, signedOut: boolean, message?, serverUrl, budget }` (`ConnectionInfo` in `src/shared/connection.ts`): `serverUrl` is the configured server or null, and `budget` the open budget (the `budget:opened` payload, `localOnly` kept current) or null. The window title (`06` §1) and the menu state (`06` §4) come from it. The renderer also asks for it with `session.state()` each time it gets a new port to the host (`02` §4). `signedOut` is true in `OfflineReadOnly` after a cancelled sign-in (no valid token); the banner, indicator (`08` §2.4) and window title (`06` §1) use it.

### 4.1 Health checks and background sync

- While `Online`, the host runs `sync()` (as a `sync` job) **every 60 s**, **on window focus** (main forwards `browser-window-focus`), and **after every write** (§5.2). No throttle is needed: measured a no-op sync at **12 ms** (median of 10, max 15 ms) against a LAN server. A remote server adds one round trip.
- A sync that throws `network-failure`/`network` (or any fetch error) → `OfflineReadOnly`, and the retry timer starts: 5 s, 10 s, 30 s, then every 60 s, plus on window focus and **Retry now**. Each attempt follows §4.2.
- **Sync events.** `sync()` itself returns `undefined`. The change signal is Actual's internal `sync` event. `actual.ts` subscribes **once per host process**, right after the first successful `init`, with the `on` function that `init()` returns: `on('sync', handler)`. It doesn't subscribe again on re-init, because old handlers are never removed (§3). The events are:

  | Event | Meaning | Host action |
  | --- | --- | --- |
  | `{ type: 'start' }` | a sync began. This includes **Actual's own automatic syncs**: every local write schedules one about 1 s later (1,048 ms measured), outside the queue. | set `Syncing` (indicator only) |
  | `{ type: 'applied', tables }` | messages were applied, **local or received**. A local write emits it too, about 30 ms after the write. | if **no host write job is running**, Actual changed data by itself (for example the schedule service posting, `12` §2): emit `data:changed { tables }`. During the host's own write jobs, don't emit it separately: collect its `tables` and add them to the `data:changed` the job emits when it finishes. Actual's schedule service can post while one of our jobs is running (`12` §2), so dropping the tables would miss those rows. **While `OfflineReadOnly` in a server session**, these are Actual's own offline writes. For example, the schedule service still advances paid schedules after a failed sync (`12` §2). Set `unsyncedChanges = true` too: they're recorded and pushed by the next successful sync. |
  | `{ type: 'success', tables }` | the sync finished. `tables` lists **only tables changed by messages received from the server**. It is `[]` when nothing new arrived, and for our own writes. | `Online`, update `lastSyncAt` (in host memory, and in the budget's device settings through the control channel, `02` §4.1, at most once a minute and on close). If `tables` is non-empty, emit `data:changed { tables }`; if it's empty, emit **nothing**. |
  | `{ type: 'error', subtype: 'network' }`, other `error` subtypes, `{ type: 'unauthorized' }` | a sync failed, **including an automatic one the host didn't start** | the §4 transitions (network → `OfflineReadOnly`, unauthorized → `AuthRequired`). Other subtypes (`out-of-sync`, `clock-drift`, `apply-failure`, none) are logged, and `Syncing` returns to `Online`: no `success` follows them, and the health and focus syncs run only while `Online`. A server that is down, or timed out by the fetch wrapper (§3), gives `{ type: 'error', subtype: 'network' }`, and `sync()` throws code `network-failure`. The message is the misleading "We had an unknown problem opening "{budget}"", so the host maps by **code** and never shows that text. Actual's automatic sync after a write fails the same way about 1 s later. |

   Integration tests saw, for example: a no-op sync gave `success` with `tables: []`. After another device wrote a note and a transaction, the next sync gave `applied` and `success` with `["notes", "transactions"]`. The first sync after `downloadBudget` lists every table it received.
- **Scoped invalidation.** The renderer maps `data:changed.tables` to Vue Query keys:
  - `transactions` → register, budget months and account balances, plus Reports (all aggregates, including full-history Money Age);
  - `categories`, `category_groups`, `category_mapping` → categories tree and budget months; `zero_budgets`, `reflect_budgets` → categories tree and budget months; these category tables also invalidate Reports;
  - `payees`, `payee_mapping` → payees, register (rows carry payee names) and rules, plus Reports (payee filters, names, and grouped rows); `rules` → payees and rules (`23` §4);
  - `schedules` → schedules, accounts (scheduled counts), payees (usage counts) and rules (schedule names);
  - `notes` → notes and reserved metadata (`04` §5.3), plus accounts (account notes), categories (category notes) and payees (`ad:payees`);
  - `accounts` → accounts and sidebar, register (transfer names, on/off-budget error states), budget months, payees (a transfer payee's enabled state), and Reports (account filters, names/status, balances, and Money Age pool);
  - `preferences` → synced prefs and formats, plus Reports (currency/format preferences).

  Each query is invalidated by every table it reads, including the fields the host derives from other tables. A remote change reports only the raw table, so a narrower mapping would leave stale names and states on screen.

  Any other or unknown table invalidates every host query. Only active queries refetch. The news feed and update check queries come from main, not the host, so `data:changed` never invalidates them (`24` §4.3).

### 4.2 Retry

Retries must not stall the UI. A retry job runs in the serial queue, so with a dead server every attempt would block reads for 10–15 s. Each attempt (timer, window focus or **Retry now**) therefore works in two steps:

1. **Reachability probe, outside the queue.** The connection monitor sends `GET {serverURL}/info` with Node's `https`/`http` module and a 5 s timeout. It's the same request as the diagnosis in §9.1, and it doesn't touch the API.
   - No answer, or a TLS/network error → stay `OfflineReadOnly` and schedule the next attempt. Nothing is queued.
   - The probe's Node error is mapped to a §9.1 `diagnosis`, so no second request is needed. **Retry now** shows a non-`none` result once (§9.1). Timer and focus attempts only log it.
2. **Retry job**, only if the probe answered → `Reconnecting`, then one queued job. Its form depends on the session:
   - **Server session** (the budget was opened online and the server was lost later): `sync()` (60 s job).
   - **Local-only session** (the app started offline, §6.2): `shutdown()` → `init({ dataDir, serverURL, sessionToken })` → `getBudgets()` to read the **current** `groupId` for this `cloudFileId` (the local copy may still hold an old one, §6.1) → `downloadBudget(groupId, { password })` → `sync()` (3 min job). It runs in the same process. Before queuing it, the host checks what it needs:
     - **No session token** in host memory (the app started offline without a stored token, `07` §1): → `AuthRequired`. The sign-in modal (§6.3) appears once the server answers, and the re-init runs after sign-in.
     - **Encrypted budget** (`hasKey`) with no password in host memory or in `e2e:` secrets (§7): the encryption prompt (§7) appears first. If it's cancelled, the session stays `OfflineReadOnly` with the banner, and retries pause until **Retry now**.

   Success → `Online`, clear `unsyncedChanges` if the sync pushed them, and emit `data:changed` (all tables after a re-init). `network-failure` → back to `OfflineReadOnly`, and the timer continues. An auth error → `AuthRequired`.

A probe answer doesn't prove that the sync endpoint works. A server that answers `/info` but hangs on `/sync` is still bounded by the 15 s fetch timeout (§3).

## 5. The write gate (requirement: "if the server isn't available it won't allow changes")

### 5.1 Gate check (before every write job)

The gate runs **inside the write job**, at its start, so nothing can run between the check and the write.

1. If state ∉ {`Online`, `Syncing`} → reject with `offline` (renderer shows the TaskDialog "You're offline" / "Changes can't be made while Actuality can't reach your Actual server. Your change was not saved." **Close**). The UI should already have disabled editing (§5.3), so this is the backstop.
2. If the last successful server contact was **> 30 s ago**, the job runs `sync()` first. If that fails → `OfflineReadOnly` and reject with `offline`, having written nothing.

### 5.2 After the write

The write job ends as soon as its writes are visible. It emits `data:changed` with the tables it wrote (plus any collected from `applied` events, §4.1), and its RPC call resolves. The sync is **not** part of the write job, so a commit returns without waiting for the network (`21` §5).

The host then queues a separate `sync` job (coalesced: if another write follows within 250 ms, one sync job covers both). Actual also schedules its own sync about 1 s after every local write. The host still syncs explicitly, so the outcome arrives promptly. `fullSync` is shared by concurrent callers (`once`: two calls give one `start` event), so this adds no extra traffic. The outcome of either sync arrives through the sync events (§4.1):

- Success → `Online`, `lastSyncAt` updated.
- Network failure → the change is already in the local cache and will be pushed on the next successful sync, because Actual's CRDT keeps it. Integration tests confirmed that a write made while the server was refusing reached a fresh second device after the next successful sync. It holds only for a **server session**; a local-only session doesn't record writes (§6.2). Set `unsyncedChanges = true` and go to `OfflineReadOnly` (writes blocked). The banner reads: "Your last change is saved on this computer but hasn't reached your Actual server yet. Editing is paused until the connection is restored." When a later sync succeeds, clear `unsyncedChanges`.

### 5.3 UI contract

- `useCanEdit()` (Pinia `connection` store) is true only in `Online`/`Syncing`. Every editing affordance binds to it: register Add and Transfer toolbar buttons and the scheduler pane's (`12` §3), inline editor open, budget cells, popover Done buttons, sidebar drag, the register's account header buttons and ⋯ menu (`13` §3–4), menu items that mutate (Import, Wipe the Slate Clean, the account menu items), and mutating buttons inside dialogs that stay viewable offline (Budget Properties' **Save Changes**, `07` §4). Disabled controls show the tooltip "Editing is unavailable while offline".
- Read-only navigation, search, export and print keep working offline. Reports reads the Actual API's local cached data when available and remains read-only (`15`); if no usable cached result exists, it shows its explicit error state.
- If the connection drops while an inline edit is open, the editor stays open. On **Done**, the gate rejects. The editor stays open, the message is shown, and the user can **Cancel**. Edits are never silently lost or auto-retried.

### 5.4 Unsynced changes on close/quit

When closing the budget or quitting with `unsyncedChanges = true`, show the TaskDialog "Some changes haven't reached your server" / "Actuality couldn't send your latest changes to your Actual server. They're stored on this computer and will be sent the next time you open this budget while connected." with buttons **Try again** (default: sync, then close if it succeeds), **Quit anyway** (or **Close anyway**), and Cancel. If `clearCacheOnExit` is on, **Quit anyway** skips clearing the cache this time, because the unsynced changes are in it, and the dialog says so in a second paragraph: "Because of this, the offline copy won't be removed when Actuality quits this time." The cache is cleared at the next quit with nothing unsynced.

Two callers lose or hand over the cache, so their dialog says so instead:

- **Change server** (§7.2): "Actuality couldn't send your latest changes to your Actual server. Changing the server removes them from this computer, so they will be lost." with **Try again** (default), **Change server anyway**, Cancel.
- **Sign out** (§7.3): "Actuality couldn't send your latest changes to your Actual server. They stay on this computer and will be sent if you sign in again as the same user. If someone else signs in, they will be lost." with **Try again** (default), **Sign out anyway**, Cancel.

## 6. Opening budgets & offline mode

### 6.1 Normal open

`connect(serverURL, password)` → login-methods check and token (§7) → `init({ dataDir, serverURL, sessionToken })` → `getBudgets()` → `SignedIn`. On later starts with a stored token, connect uses it directly. Without one, the sign-in modal appears over the Budget List (§6.3, `07` §1). Choosing a budget → `downloadBudget(groupId, { password: e2ePassword? })` → `sync()`. The Sync ID is the file's **`groupId`**. Passing `cloudFileId` fails with "Budget … not found".

- **Budget identity is the `cloudFileId`, not the `groupId`.** The `groupId` **changes** whenever a budget's sync is reset: enabling encryption, changing its password, or `sync-reset` all do it. The `cloudFileId` never changes. So the app stores and matches budgets by `cloudFileId` everywhere: recent budgets, last budget, device settings and secrets (`19`). It reads the **current** `groupId` from the `getBudgets()` remote entry with that `cloudFileId` just before each `downloadBudget`.
- `getBudgets()` lists a budget that's cached on this device **twice**: once as the local copy (with `id`, and `hasKey` absent) and once as the server file (`state: "remote"`, with `hasKey`), both with the same `cloudFileId`. After a reset, the local copy keeps the **old** `groupId` until it's downloaded again. **It never throws when the server's list can't be fetched** (26.11.0: `get-remote-files` logs the failure and returns null, also for an error reply), so the result then holds the local entries only. A list without a single remote entry is therefore checked with the §4.2 reachability probe: if the server doesn't answer, the host treats it as a network error (`offline`; an open falls back to the local copy, §6.2) instead of "no budgets" or "budget not found", and the user-switch cleanup (§7.1) never deletes caches on an empty list from an unreachable server. The Budget List de-duplicates by `cloudFileId`, and "Offline copy" ✓ means a local entry exists. → `Online` → `budget:opened` event `{ cloudFileId, groupId, name, budgetType, localOnly }`.
- **Tracking budgets are refused.** Actual's Tracking mode is out of scope (`01` §3). Every open (online, the local-only fallback of §6.2, a new budget and an imported one, `07` §3.4) reads the synced pref `budgetType` (`04` §3) once the budget is loaded, before the state changes or `budget:opened` is sent. If it is `'tracking'`, the host calls `shutdown()` and returns to `SignedIn`, or to `Disconnected` for a local-only open. It then fails the open with `validation`, details `{ code: 'tracking-budget' }`. **It fails closed:** if `getPreferences()` throws, the budget is closed the same way and the open fails with that error, so an unreadable type never opens as envelope. Nothing is recorded as the last or a recent budget. The renderer shows the warning in `07` §3.2.
- **A tracking export is refused before it is uploaded.** `importBudget` uploads in the same call that loads the budget, so for an Actual export (`07` §3.4) the host reads the type from the zip first (`src/host/budget-export.ts`): the `preferences` row `budgetType` in its `db.sqlite`, read with `node:sqlite` from memory. An export from before Actual had that table (it has none) keeps the pref in `metadata.json`, where `'report'` is Actual's old name for Tracking. Values `'tracking'` and `'report'` fail the import with the same `tracking-budget` error before the open budget is closed. A zip the host can't read counts as not tracking: Actual's importer judges it, and the open check above still applies. YNAB imports always create envelope budgets. `cloudFileId` is the budget's identity, which main records for crash recovery (§6.5). `groupId` is the Sync ID used for this open; it changes after a sync reset.

### 6.2 Server unreachable at startup

If `init` (or `downloadBudget`) fails with a network code, or the startup login-method probe (`07` §1) can't reach the server, and the budget being opened has a local copy (any `getBudgets()` entry with matching `cloudFileId` and a local `id`, or this budget's remembered `localId` in device settings `19` §2, read through the control channel), the following steps run. A local-only open needs no token, so this works without a stored token too.

1. `init({ dataDir })` with **no `serverURL`** (local-only), in the same process, straight after the failed `init`.
2. `loadBudget(localId)`. State → `OfflineReadOnly`. The banner shows the last sync time from device settings (`lastSyncAt`). Reads, `aqlQuery` and `getBudgets()` (local entries only) all work.
3. Retry (§4.2, local-only form): once the reachability probe answers, `shutdown()` → `init` with server → `downloadBudget` → `sync()`. If this succeeds → `Online` and `data:changed`. **Integration tests confirm that re-init in the same process works:**
   - after a failed init, a local-only session and a hung shutdown;
   - 5 cycles in a row at about 250 ms each, with no heap growth (82 → 84 MB);
   - writes made afterwards reach the server.

   The host process is **not** restarted to reconnect. A restart is only for host crashes and stuck hosts (§3, §6.5).

**Rules for a local-only session:**

- **It MUST NOT write.** With no server, `loadBudget` sets Actual's syncing mode to `disabled`. Writes are applied to the cache but recorded in no sync message (a local check counted 0 `messages_crdt` rows after a write), so they would never reach the server, and the cache would silently drift from it. The write gate (§5.1) already blocks writes in `OfflineReadOnly`. `actual.ts` adds a backstop: every write wrapper throws `offline` while the session is an **offline fallback** for a server budget (this section). Budgets that exist only locally and were never uploaded, which only the test harness creates (`21` §1), have no server copy to drift from. The harness opens them with an explicit `localTestBudget` flag on `actual.ts` that skips the backstop. The flag is not reachable through RPC.
- **It MUST NOT call `sync()`.** In this mode `sync()` throws a code-less "We had an unknown problem opening …". It also switches the syncing mode to `enabled`, after which writes *are* recorded. The host therefore never calls `sync()` in a local-only session.
- **Server lost mid-session** (the budget was opened online): the host stays in the server session, with no re-init. Writes are blocked by the gate. Reads and a retry `sync()` (§4.2, server-session form) continue to work.
- **`downloadBudget(groupId)` while the server is down** loads the local copy, then throws `network-failure`, leaving the budget **open** and readable. The host still treats it as a failure and goes through steps 1–2, so the offline session is always local-only and predictable.
- **Failure times** (real sockets):
  - closed port: `network-failure` in about 15 ms;
  - non-routable address: about 10.7 s (undici's connect timeout);
  - half-open server: bounded only by the fetch wrapper (§3).

  So an offline start can take up to 15 s before the cached budget opens.

With no local copy and no server → the budget list shows "Can't reach your Actual server at {url}." with **Retry** and **Change server…**. In this state the Budget List shows **no budgets at all**, cached or not. The only offline open is the startup fallback above for the last budget. Closing an offline budget therefore returns to the empty "Can't reach…" list.

### 6.3 Re-authentication

`invalid-password`/`token-expired`/`unauthorized`, or a startup with no stored token (`07` §1) → `AuthRequired`. The host first re-runs `session.probeLogin` (§7). The modal "Sign in to your Actual server" (over the open budget, or over the Budget List) then has either a Password field and **Sign in**, or **Sign in with {displayName}** on an OpenID server (the browser flow, §7), plus [x] "Stay signed in on this computer" and Cancel (Cancel → §4: with a budget open it stays open read-only; otherwise the Connect screen). On success: fetch a new token (§7), re-init with it, store or replace the token if "Stay signed in" is ticked, and continue.

### 6.4 Session start tasks

Some write jobs run once per budget session, at the session's **first transition to `Online`**: either the end of a normal open, or the first successful reconnect after an offline open (§4.2). They run in this order:

1. the missing `needs-review` tag entity is created (`04` §5.2);
2. the carryover extension runs (`09` §6.4).

They run once per session: a reconnect later in the same session skips them. They also run again after the first successful sync of each local day (`09` §6.4, step 4). Both are idempotent, so running them again is harmless.

### 6.5 Host crash recovery

If the host exits unexpectedly, or exits itself because it's stuck (§3), main restarts it at once (`02` §1). The renderer keeps its screens and view state and shows "Reconnecting…" in the banner. Writes are blocked until recovery finishes. The new host restores the previous session **automatically**:

1. Main tells the new host what to restore once it is ready (`02` §4.1 `session:restore`): `serverUrl`, the open budget's `cloudFileId` (if any), and whether it was a server or local-only session. Main tracks these from the `connection:state` and `budget:opened` events, which the host also sends to main. It takes the session to restore **when the host crashes**: the new host reports its own first state (`Disconnected`, no budget) before it reopens anything, which would otherwise overwrite the record. Main keeps that session until a host replies that its reopen attempt has ended, so a crash during the reopen restores the same session again.
2. The host re-runs the normal flow with the stored secrets: `session.connect` with `server:{url}`, then `session.openBudget` with `e2e:{cloudFileId}`, or the local-only fallback (§6.2) for a local-only session.
3. Whatever the crash took from host memory and isn't stored is asked for in the usual way: the sign-in modal if there's no stored token (§6.3), and the encryption prompt if the password wasn't remembered (§7).
4. If a reopen step fails, the normal error handling applies (§9). The host reports a budget that didn't reopen with the event `session:restoreFailed { cloudFileId, error }` (§8), and the renderer handles it exactly like a failed `session.openBudget`: it leaves the main canvas for the Budget List, then shows the encryption prompt (step 3) or the error's dialog. An auth error needs nothing more: the sign-in modal is already up, and the open resumes after the sign-in.
5. **Interrupted slate wipe:** the host sends `job:slateWipe { phase: 'started', backupPath }` to main when `slateWipe.run` begins, and `{ phase: 'ended' }` when it finishes (`02` §4.1). Main keeps the record in memory. If the host crashes or is restarted while the record exists, main adds `interruptedSlateWipe: backupPath` to the `session:restore` it sends the new host (once). After the reopen, failed or not, the host emits `slateWipe:interrupted { backupPath }` (§8), and the renderer shows the slate wipe error dialog (`18` §2) with "Your budget may be partly reset" and the backup path.

Unsynced changes survive a crash: in a server session they are already in the cache's CRDT log (§5.2). An inline edit open in the renderer stays open; its **Done** is rejected by the gate until the state is `Online` again. If the host crashes **3 times within 5 minutes**, main stops restarting it and shows the TaskDialog "Something went wrong" / "Actuality's connection to Actual keeps stopping unexpectedly. Restart Actuality to try again." with **Show Logs Folder** and **Quit**. From then on the renderer's host client rejects every call with `internal` and `details.code: 'host-failed'`: those in flight, those waiting for a port, and later ones, until a new port arrives. Nothing waits for a host that won't come back, and these errors show no dialog of their own, only the one above.

## 7. Authentication & encryption

- **Server sign-in uses a session token.** The password is asked on the Connect screen (`07` §2) and is **never stored**.
  1. **Get a token.** The API never returns one: after a password `init` it is kept in memory only. So `session.connect` makes one REST call from the host, `POST {serverURL}/account/login` with `{ loginMethod: 'password', password }`, and gets back `{ status: 'ok', data: { token } }`. This is the server's login endpoint, used by every Actual client. The app makes only a few direct HTTP calls to the server: this login, the OpenID login request, `GET /account/login-methods` and `GET /account/validate` (below), and the `/info` probe in §9.1. It runs in the host, so it uses the same TLS settings. Errors: an error response with `reason: 'invalid-password'` → "That password is incorrect.". That is the reason the API's own sign-in reports for the same call. A network failure → the §9.1 diagnosis.
  2. **Sign in with it:** `init({ dataDir, serverURL, sessionToken })`, always, including later starts. Integration tests confirm that listing, downloading and syncing work with only the token.
  3. **"Stay signed in on this computer"** (`07` §2): the host sends the **token** to main over the control channel (`secrets.set`, `02` §4.1), and main stores it with safeStorage as `server:{url}` (`19` §4). Otherwise the token lives only in host memory for the session. Ticking the option later in Preferences calls `session.setStaySignedIn(true)`, which stores the in-memory token the same way. Unticking it deletes the stored token. The password is dropped as soon as step 1 returns.
  4. **Token rejected:** `init` throws `token-expired` for an unknown, expired or reset token → `AuthRequired` (§6.3). The stored token is deleted, and a fresh one is fetched after the user signs in again.
  5. **Server unreachable:** a token `init` throws `network-failure`, because it validates the token online. The offline path (§6.2) uses `init` **without** `serverURL` anyway.

  **What a token is:** the server returns the **same token for every password login**, and earlier tokens stay valid. The internal `subscribe-sign-out` only clears local storage, and the API can't revoke a token on the server. So a stored token is a full credential for that server until its password changes. It just doesn't reveal the password. "Forget"/sign-out in the app deletes the stored token (`19` §4).
- **Choosing the sign-in method.** Before asking for anything, `session.probeLogin(serverURL)` calls `GET {serverURL}/account/login-methods`. It returns `{ status: 'ok', methods: [{ method, active, displayName }] }`, where `active` is the number `1` or `0`. The app treats `true` as `1` as well, because the API's own default uses a boolean. The **active** method decides:

  | Active method | Connect shows |
  | --- | --- |
  | `password` | the password form (steps 1–5 above) |
  | `openid` | **Sign in with {displayName}**: the OpenID browser flow below |
  | anything else (e.g. `header`), or none | "This server uses a sign-in method Actuality doesn't support yet." |

  On server 26.2.0, the active OpenID configuration returned:
  - `methods: [{ password, active: 0 }, { openid, active: 1, displayName: 'OpenID' }]`;
  - `/account/needs-bootstrap` reported `loginMethod: 'openid'` and `multiuser: true`.

  **No password fallback on OpenID servers.** A login that explicitly names `loginMethod: 'password'` still succeeds there by default, as the **ADMIN** user. The app doesn't offer it: it follows the server's active method. A login that names no method lets the server pick its active method; on an OpenID server that fails with `Invalid redirect URL`. So the host always sends `loginMethod` explicitly.

- **OpenID sign-in.** The flow follows the same token model as passwords, and the server does the OAuth exchange itself:
  1. **Loopback listener.** The host starts an HTTP listener on a random port, bound to **both** `127.0.0.1` and `::1`, so `localhost` works whichever address the browser resolves. Both are required: in testing, the browser on Windows connected to **`::1`**. If one address can't be bound (for example IPv6 disabled), the listener continues on the other.
  2. **Get the redirect.** `POST {serverURL}/account/login { loginMethod: 'openid', returnUrl: 'http://localhost:{port}' }` → `{ status: 'ok', data: { returnUrl: <identity-provider URL> } }`.
     - The server accepts `http(s)://localhost` with any port and path, but **rejects** `127.0.0.1`, `[::1]`, custom schemes and other hosts with `400 Invalid redirect URL`. So the return address MUST be spelled `localhost`.
     - The identity-provider URL carries `redirect_uri = {serverURL}/openid/callback`. The server receives the code, not the app, using PKCE (`code_challenge_method=S256`).
  3. **Browser.** While `session.connectOpenId` is still pending, the host asks main to open the URL over the control channel (`shell.openExternal`, `02` §4.1). Main opens it only if it is `http:` or `https:`, like every external link (`02` §6).
     - The Connect screen (or the §6.3 modal) shows "Waiting for you to sign in to {displayName} in your browser…" with **Cancel**, and the hint: "If your browser warns about the server's security certificate, your computer needs to trust that certificate too. Actuality's certificate setting doesn't apply to your browser."
     - Reason for the hint: after sign-in, the **browser** visits `{serverURL}/openid/callback`. The app's "Trust this certificate file…" setting (`NODE_EXTRA_CA_CERTS`, `02` §6) only affects the host. A self-signed server certificate must also be trusted by the OS or browser, or the callback never arrives.
  4. **Callback.** After sign-in, the server redirects the browser to **`{returnUrl}/openid-cb?token={36-character token}`** (`GET`, path `/openid-cb`, one query key `token`). The browser then also requests `/favicon.ico`, which gets a 404. The listener:
     - accepts the first `GET` that carries a `token`;
     - answers with a page reading "You're signed in to Actuality. You can close this tab.";
     - closes, and ignores any other request.

     It times out after **5 min** with "Sign-in wasn't completed. If your browser showed a certificate warning, trust the server's certificate on this computer and try again." **Cancel** closes it at once.
     - When the token arrives, the host sends `window.focus()` over the control channel, and main brings the window to the front: `win.show()`, `win.focus()`, and on macOS `app.focus({ steal: true })`. This returns the user from the browser.
  5. **Use the token.** `init({ dataDir, serverURL, sessionToken })`, exactly as for passwords. Integration tests confirm that listing works (6 budgets), `subscribe-get-user` reports `loginMethod: 'openid'` and `tokenExpired: false`, and `/account/validate` returns `validated, userName, permission, userId, displayName, loginMethod, prefs`. "Stay signed in" stores it as `server:{url}` (`19` §4).
  6. **Re-authentication** (§6.3) **runs `session.probeLogin` again** first, because an admin can switch the server between password and OpenID at any time. The modal then shows the password field or **Sign in with {displayName}** to match, and for OpenID repeats steps 1–4.
  7. **User check** (§7.1). After every sign-in, the host reads `userId` from `GET /account/validate`, the same call the API makes during a token `init`.

  Security notes:
  - The token travels in the URL of a loopback redirect, so it can appear in the browser's history. That is how Actual's own clients receive it too.
  - A forged request to the listener can only deliver a bad token, which `init` rejects with `token-expired`.
  - Token lifetime: `/account/validate` reports **no expiry**, so the app can't predict one. If the server expires or revokes the session, the token takes the normal `token-expired` → `AuthRequired` path, and the user signs in through the browser again.
- **End-to-end encryption is per budget.** Budget Properties can enable it or generate a replacement key (§7; `07` §4). The public API supports opening encrypted budgets with `downloadBudget(syncId, { password })`, but has no public method to create or replace a key. Actual 26.11.0 exposes the internal `key-make` handler on the `init()` result's `send` method; it creates a randomized key from the password and resets sync, uploading the loaded local budget as the new source of truth. This is an internal, version-sensitive handler, not a stable public API. The host uses it only inside a serialized, online write job and reports an explicit unsupported/error result if the handler or operation is unavailable. Encryption **can't be turned off**: reset keeps the key, and only an export → import makes an unencrypted *copy*. Facts the app relies on:
  - **The key isn't kept between sessions.** The API holds it in memory only, so **every** `downloadBudget` of an encrypted budget needs the password, even when it's cached on this device. With "Remember on this computer", the host reads `e2e:{cloudFileId}` (`19` §4) through the control channel. Otherwise the prompt below appears each time the budget is opened online.
  - **The host keeps the password in memory for the open budget's session**, whether or not it is remembered. Re-auth (§6.3) and reconnect re-inits (§4.2) then call `downloadBudget` again without asking. The copy is dropped when the budget closes, on sign-out and when the host exits. It never leaves the host except to `secrets.set` when "Remember" is ticked.
  - **Offline needs no password.** `loadBudget(localId)`, without a server, opens the cached copy, because the local database isn't encrypted (§6.2).
  - **Enabling or replacing a key resets sync.** Before the operation, Actuality explains that this device's currently loaded budget becomes the server's new source of truth. Any changes on other devices that have not reached this copy can be lost; users should sync their other devices first. The operation must pass the normal write gate, run in the host's serial queue, and never be retried automatically after an ambiguous failure. On success, the host keeps the entered password in memory, optionally stores it as `e2e:{cloudFileId}` when the user chose Remember (`19` §4), refreshes the remote `hasKey`/`groupId` for the stable `cloudFileId`, and syncs. A reset on another device follows the existing `file-has-reset` flow (§9).
  - **Encryption limits.** End-to-end encryption protects budget data sent to the sync server. It does not encrypt the local Actual cache or server-side bank-sync credentials. Budget backup exports are also unencrypted. Explain these limits before the user enables encryption.
  - **End-to-end encrypted budgets** (`hasKey: true`): `downloadBudget` throws `missing-key` → prompt "This budget is encrypted" / "Enter the encryption password for "{name}"." [password] [x] Remember on this computer → **Open**. `decrypt-failure` (Actual's message: "Unable to decrypt file with this password. Please try again.") → "That password didn't work. Try again.". A stored `e2e:` secret that fails is deleted first. `old-key-style` → error "This budget uses an old encryption format. Open it once in Actual's web app to upgrade it, then try again."

### 7.1 Multi-user servers

OpenID servers run in **multi-user mode**: `needs-bootstrap` reports `multiuser: true`. Budgets then have an owner, and admins grant other users access. The app supports this as a client, not as an administrator.

- **Budget List.** `getBudgets()` remote entries carry `owner` (a user id) and `usersWithAccess` (26.11.0 API source). The server lists only the budgets the user can access. The list shows **names only**, plus a small **Shared** tag on budgets whose `owner` isn't the signed-in user's `userId`. Its tooltip reads "Shared with you by the budget's owner." The owner's name isn't looked up: that needs the admin-only users list.
- **Permissions.** A regular (`BASIC`) user may be refused some operations, for example renaming a budget they don't own (`save-prefs { budgetName }` → `/update-user-filename`). The app handles refusals conservatively:
  - a refused server operation maps to RPC error `actual`, with the message "You don't have permission to do that on this budget. Ask the budget's owner or the server's admin.";
  - Budget Properties' name field is read-only on **Shared** budgets, with that message as a tooltip;
  - the app never tries to work out roles itself.
- **User and access management** (Actual web's Users and User Access pages, ownership transfer) is **out of scope** (`01` §3). Help text: "Manage users and budget access in Actual's web app."
- **Switching users on one computer (clear the other user's cache).** One device can be used by different server users one after another: sign out, then sign in as someone else. The offline cache (`03` §2) and the per-budget device settings would otherwise still hold the first user's budgets, visible in the Budget List and openable offline. So:
  1. After every sign-in (§7 step 7), the host compares the `userId` with `serverUsers[serverURL]` in `settings.json` (`19` §1), read and written through the control channel (`02` §4.1).
  2. **Same user, or none stored** (the first sign-in, or a single-user password server where every login is the same user): store it and continue.
  3. **Different user:**
     - First, if the previous user's open budget has `unsyncedChanges`, the §5.4 dialog runs. It can only be reached when switching from inside an open session.
     - Then the host closes the budget and **deletes every cached budget that isn't in the new user's server budget list** (`getBudgets()` local entries without a matching remote `cloudFileId`). Through the control channel it also deletes their `budgets/{cloudFileId}.json` device settings and `e2e:` secrets, and drops them from `recentBudgets`/`lastBudget`. The app connects to one server at a time, and a server change wipes everything (§7.2), so every cached budget belongs to the current server, and "not visible to the new user" is the rule.
     - Unsynced changes in a closed, cached budget of the previous user are lost. They exist only if that user chose **Quit anyway** (§5.4), which already said they stay on this computer only. This is accepted.
     - It stores the new `userId` and continues to the Budget List.
     - Nothing is asked: the other user's data never shows, even briefly. The Budget List then lists only the new user's server budgets.
  4. Offline starts can't check the user, because there's no server to ask. The startup fallback (§6.2) only opens `lastBudget`, and Sign out clears it (§7.3). So after a sign-out nothing opens offline, and otherwise the offline budget belongs to the last user who signed in on this device without signing out.

### 7.2 Changing the server

A cached budget doesn't record which server it came from, so the cache only ever holds budgets of the **current** server. **Change server…** (Budget List, Preferences, `07` §2, §7) therefore wipes everything tied to the old server, after a confirmation: "Change server?" / "Actuality will sign out of {url} and remove its budgets from this computer. Your budgets on the server are not affected." **Change server** / Cancel.

`session.forgetServer()`, one host job:

1. If a budget is open: the §5.4 unsynced-changes check, then close it.
2. `shutdown()`, then delete `actual-cache/` (§2) in full.
3. Through the control channel: delete every `budgets/*.json` device-settings file, every `server:` and `e2e:` secret, and the old server's `serverUsers` entry, and reset `serverUrl`, `lastBudget` and `recentBudgets` (`19`).
4. State → `Disconnected`. The renderer shows the Connect screen with an empty address.

Nothing from the old server is kept, so switching back later means downloading its budgets again.

### 7.3 Signing out

**Sign out** (Budget List and Preferences, `07` §3, §7) ends the session on this server without wiping it, so another user can sign in. `session.signOut()`, one host job:

1. If a budget is open: the §5.4 unsynced-changes check, then close it.
2. `shutdown()`. Drop the token and any encryption passwords from host memory. Through the control channel, delete `server:{url}` and **every `e2e:` secret**, and clear `lastBudget`. So the next startup has nothing to open offline (`07` §1), and no saved encryption password can be reused by whoever signs in next. The offline cache, `recentBudgets` and the device settings are **kept**.
3. State → `Disconnected`. The renderer shows the Connect screen with the address filled in.

If the next sign-in is a **different user**, the user-switch rule (§7.1) removes the previous user's cached budgets. If it's the same user, the cache is still there, and only remembered encryption passwords have to be entered again. Confirmation is only asked when the step-1 check needs it. The API can't revoke a token on the server (§7), so signing out only removes it from this computer.

## 8. RPC method catalog (`HostApi`)

Grouped by service. All amounts are minor-unit integers. Every write method is gated (§5). Names are normative. Parameter shapes are defined in `src/shared/rpc/host-api.ts` from the types in `04`.

| Group | Methods |
| --- | --- |
| session | `session.probeLogin(serverURL)` → `{ method: 'password' \| 'openid' \| 'unsupported', displayName }` (§7), `session.connect(serverURL, password?, remember)` (no password: use the stored token, §6.1), `session.connectOpenId(serverURL, remember)` (resolves when the browser flow returns a token, §7; cancellable with `session.cancelOpenId()`), `session.listBudgets()`, `session.openBudget(cloudFileId, e2ePassword?, remember?)` (the host resolves the current `groupId`, §6.1), `session.closeBudget({force})`, `session.syncNow()`, `session.retryConnection()` → `{ connection, diagnosis, errorCode? }` (§4.2, §9.1; `errorCode` is Node's, for the `tls-other` message), `session.cancelSignIn()` (Cancel on the sign-in modal, §4 `AuthRequired`), `session.state()`, `session.serverVersion()`, `session.setStaySignedIn(bool)` (§7 step 3), `session.clearCache()` (§2), `session.signOut()` (§7.3), `session.forgetServer()` (§7.2) |
| budgets (file) | `budgetFile.create(name, template, formats)` (`runImport` + upload check, `07` §4), `budgetFile.properties()` (includes encryption status from remote `hasKey`), `budgetFile.updateProperties(...)` (incl. `name` → rename, `07` §4), `budgetFile.setEncryptionKey(password, remember)` (calls Actual's internal `key-make`; enables encryption or replaces the key, including sync reset, §7), `budgetFile.exportBackup(path)` (the host writes the unencrypted zip, `07` §6), `budgetFile.importFile(path, type, importedSuffix, force?)` (`07` §3.4; `importedSuffix` is "(imported {date})" in the UI language) |
| accounts | `accounts.list()` (with balances & metadata), `accounts.create(input)`, `accounts.update(id, patch)`, `accounts.close(id, transferAccountId?, transferCategoryId?)`, `accounts.reopen(id)`, `accounts.delete(id)`, `accounts.reorder(id, beforeId \| null, group)` |
| transactions | `transactions.list({ accountId \| 'all' })`, `transactions.get(id)`, `transactions.commit(edit)` (full pipeline result, `11` §6), `transactions.setCleared(ids, state)`, `transactions.approve(ids)`, `transactions.categorize(ids, categoryId \| null)` (ids may be split lines: the error popovers set or clear a line's category, `10` §6.3), `transactions.delete(ids)` → undo token, `transactions.undo(token)`, `transactions.moveToAccount(ids, accountId)` → undo token, `transactions.setDate(ids, date, clearReconciled?)` → undo token (a write; all-or-nothing; `clearReconciled`: reconciled transactions or other sides that become Cleared; `10` §6.1), `transactions.merge(idA, idB)`, `transactions.forCategoryMonth(categoryId \| groupId \| 'uncategorized' \| 'all', month)` (`'all'`: every expense category, the totals row's Outflows, `09` §6.6), `transactions.incomeForMonth(month)`, `transactions.lastForPayee(payeeId)`, `transactions.nextCheckNumber(accountId)` |
| tags | `tags.list()`, `tags.create({ tag, color?, description? })`, `tags.update(id, fields)`, `tags.delete(id)`, `tags.discover()` (find note tags without entities; Actual's Tags management behavior, `04` §5.2) |
| budget | `budget.months()`, `budget.month(month)` (normalized, `09` §2), `budget.setAmount(month, categoryId, amount)`, `budget.setAmounts(month, entries[])` (batch), `budget.setCarryover(month, categoryId, bool)`, `budget.hold(month, amount)`, `budget.resetHold(month)`, `budget.uncategorized()` → `{ exists }` (whether the Uncategorized row shows: such transactions in any month, `09` §4.2; each month's row comes with `budget.month`), `budget.quickBudgetStats(month)` (every expense category, `09` §5). Budget writes refuse months outside `budget.months()` with `validation` (`09` §2). |
| categories | `categories.tree()`, `categories.createGroup(name)` (a numbered name if taken, " 2", " 3"…, placed at the top, `09` §4.1), `categories.updateGroup(id, patch)`, `categories.deleteGroup(id)`, `categories.create({ groupId } \| { groupName }, name)` (Add New Category, `11` §4.2: a new group is created in the same job; the category goes to the end of its group), `categories.update(id, patch)`, `categories.delete(id)`, `categories.move(id, groupId, beforeId \| null)`, `categories.moveGroup(id, beforeId \| null)`, `categories.deleteImpact(idOrGroupId)` (budgeted months, transaction count/total), `categories.setHidden({ categoryIds, groupIds, hidden })` (Show Hidden Categories in one job, `09` §6.5), `categories.moveSupport()` → `{ category, group }` (false once a move handler was found missing, §3). `categories.create` takes `unique` to number a taken name (`09` §4.3). |
| notes | `notes.get(id)`, `notes.set(id, text)` (refuses `ad:` and `ad-bak:` ids with `validation`: reserved notes change only through their own methods, `04` §5.3), `notes.cellNotes(month)`, `notes.setCellNote(month, categoryId, text)`, `notes.monthNote(month)`, `notes.setMonthNote(month, text)` |
| payees | `payees.list()` (incl. usage counts, enabled, transfer), `payees.rename(oldId, newName, { transferAccountId?, categoryId? })` (rename/merge semantics `14` §3; `transferAccountId` when the new name is "Transfer: X", because the host never parses UI text; `categoryId` for "Rename and categorize", `11` §8), `payees.renameImpact(oldId, { transferAccountId?, excludeId? })` → `{ total, renameable, uncategorized }` (`excludeId`: the transaction being edited), `payees.combine(ids, newName)`, `payees.setEnabled(ids, bool)`, `payees.rules(payeeId)`, `payees.setRenameRules(payeeId, conditions[])`, `payees.applyRenameRules(payeeId, dryRun)`, `payees.setAutoCategory(payeeId, categoryId \| null)` |
| rules | `rules.list()` → every rule in run order, `rules.save(rule)` → `{ id }`, `rules.delete(ids)`, `rules.matches({ conditionsOp, conditions })` → `{ rows, more } \| null`, `rules.applyActions({ ids, actions })` → `{ count }` (`23` §4) |
| schedules | `schedules.list({accountId \| 'all'})`, `schedules.save(edit)`, `schedules.delete(ids)`, `schedules.enterNow(ids)` → new transaction ids, `schedules.skip(ids)`, `schedules.moveToAccount(ids, accountId)`, `schedules.draftFromTransaction(id, mode: 'recurring' \| 'move')` → a pre-filled draft for the Schedule dialog (a read), `schedules.preview({ date, count })` → the next occurrences of an unsaved Once date or `RecurConfig`, `schedules.linked(id)` and `schedules.matches(draft)` → the dialog's transaction lists (`12` §3.1), `schedules.support()` → `{ skip, upcomingDates }` (false once a schedule handler was found missing, for the UI fallbacks) (no `enterDue`: Actual's service posts due occurrences, `12` §2) |
| reconcile | `reconcile.clearedThrough(accountId, date)`, `reconcile.finish(accountId, statementDate, target, createAdjustment, texts)` (`texts`: the adjustment's notes in the UI language; Finish also writes the account's `last_reconciled`, `13` §6.3) |
| import | `import.parse(filePath)` → `{ token, format, accounts, mappings, startDates }` (the parsed file is kept under `token`), `import.run(token, mappings[], texts)` → per-account results (each account is its own write job). There is no dry-run preview: the dialog previews the parsed rows, and the counts come from the real import (`16` §1.5). |
| export | `export.data({ kind: 'csv' \| 'qif' \| 'budgetCsv', folder, budgetName, timestamp, view, overwrite })` (refused with `conflict` and `details.names` while files exist, `16` §2.1), `export.reportCsv({ path, content })` (a report CSV the renderer built, written to the path chosen in the native save dialog; refused with `validation` unless it ends in `.csv`; write errors as in `16` §2.1 and §2.4) |
| slateWipe | `slateWipe.impact(cutoffMonth \| null)` → `{ transactions, firstMonth }` (the confirm step's count and the cutoff combo's first month, `18` §2), `slateWipe.run({cutoffMonth \| null, backupPath, texts})` → `{ backupPath, deleted }` (`texts`: the Starting Balance payee name in the UI language) |
| prefs | `prefs.synced()`, `prefs.setSynced(key, value)` |
| reports | `reports.get({ kind, filters, options, today, weekStart })` → a bounded report DTO for one active report (`15` §4, §7). `today` and `weekStart` are the renderer's calendar date and the budget's first day of week, so presets, weekly periods and unobserved future periods resolve the same way on both sides. The kind, filter ids/date ranges, and report-specific options are strict zod unions; invalid or unsupported combinations return `validation`. This is a read-only method and does not use the write gate. It uses the normal 60 s read-job timeout; a timeout fails only this call and does not change connection state (§3). |

`reports.get` gathers all Actual inputs for that calculation inside one serial read job. The host normalizes split lines, signs, account selection and open/closed status, and names before returning aggregate rows and series; no raw transaction ledger crosses RPC. It performs no writes. Report queries use a `reports` Vue Query key root containing the report kind, effective committed filters, and options. Draft filters are excluded. Data changes invalidate the report root for the dependency tables in §4.1; unrelated known tables do not refetch reports. Unknown tables retain the catch-all invalidation behavior.

The renderer starts a query only for the active tab. Offline reads use the API's local cache when available. A timeout or API error remains an error; it is not converted into an empty success. With the 20k transaction fixture, host aggregation plus DTO serialization must complete in under 1 s with a response no larger than 1 MB (`21` §5).

Host → renderer events: `connection:state` (§4), `data:changed { tables }` (§4.1), `budget:opened` (§6.1), `job:progress { label, done, total }` (long jobs; `label` names the step, e.g. `slateWipe.delete`, `18` §2), `session:restoreFailed { cloudFileId, error }` (a restarted host couldn't reopen the budget, §6.5), `slateWipe:interrupted { backupPath }` (§6.5 step 5). The OpenID flow needs no events: the host opens the browser and focuses the window through main (§7), and `session.connectOpenId` resolves when it's done.

Host ↔ main control-channel methods are listed in `02` §4.1.

Error codes (`RpcErrorCode`): `offline`, `auth`, `not-found`, `validation`, `conflict`, `timeout`, `actual` (with Actual's `code`/`message` in `details`), `internal`.

## 9. Mapping Actual errors to UI

| Actual code | UI |
| --- | --- |
| `network-failure`, `network` | §4 offline flow. On Connect (and on the Budget List's "Can't reach" state, §6.2), run the **connection diagnosis** (§9.1) first. If it finds nothing specific: "Couldn't reach a server at {url}. Check the address and that the server is running." |
| `invalid-password` | Connect: "That password is incorrect." |
| `token-expired`, `unauthorized` | §6.3 |
| `budget-not-found` | "This budget no longer exists on the server." → refresh the list |
| `file-has-reset` | The budget's sync was **reset on another device**: encryption was turned on, its password changed, or a sync reset. This device's copy is stale. It arrives as the error **code** of `downloadBudget`/`sync`, and as the sync-event `subtype` (§4.1), including from Actual's automatic syncs. Actual's *message* is a generic "We had an unknown problem opening …", so match on the code. The host blocks writes (state `Error`, but without returning to the Budget List) and shows the TaskDialog "This budget was changed on another device" / "Its sync was reset — for example, encryption was turned on or its password was changed. Actuality needs to download it again." with **Download again** (default) and **Close budget**. If `unsyncedChanges` is set, it adds: "Changes made on this computer that hadn't reached the server will be lost." **Download again** reads the current `groupId` for this `cloudFileId` (§6.1), then runs `downloadBudget(groupId, { password })`, prompting for the encryption password if `hasKey` (§7). That replaces the stale local copy. |
| `missing-key`, `decrypt-failure`, `old-key-style` | §7 |
| `out-of-sync-migrations` | "This budget can't be opened. It may be damaged or from a much older version of Actual." |
| `tracking-budget` (the host's, §6.1) | `07` §3.2: "This budget can't be opened in Actuality" → the Budget List |
| other | TaskDialog "Something went wrong" / `{message}` + Close. Logged by the host (rotating log file in `{userData}/logs`). |

### 9.1 Connection diagnosis (certificate and address problems)

`@actual-app/api` reports TLS failures as a plain `network-failure`: a self-signed certificate with no subjectAltName gives "Authentication failed: network-failure". So the API's code alone can't tell "server is down" from "certificate is rejected".

When `init` or `downloadBudget` fails with `network-failure`/`network`, the host runs `diagnoseConnection(serverURL)` (in `host/connection.ts`). It runs **in the host**, so it uses the same Node TLS settings and `NODE_EXTRA_CA_CERTS` as the API (`02` §6).

How the diagnosis works:

- It makes one `GET {serverURL}/info` with Node's `https`/`http` module and a 5 s timeout.
- It maps the Node error `code` to a `diagnosis`.
- `session.connect` (or `openBudget`) then rejects with `offline` and `details: { diagnosis, host }`.
- The renderer shows the matching message inline on the Connect screen. On the Budget List and at startup it shows a TaskDialog.

The diagnosis is advisory. If the `/info` probe itself **succeeds**, the result is `none` and the generic message is shown.

| `diagnosis` | Node error codes | Message (exact) | Action button |
| --- | --- | --- | --- |
| `tls-name-mismatch` | `ERR_TLS_CERT_ALTNAME_INVALID` | "The security certificate for {url} doesn't match this address. The certificate must list "{host}" as a DNS name or IP address (subjectAltName). Create a new certificate for your server that includes it, or connect using an address the certificate already lists." | **Learn more** (opens the Actual HTTPS docs) |
| `tls-untrusted` | `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `UNABLE_TO_GET_ISSUER_CERT` | "Actuality doesn't trust the security certificate for {url}. If your server uses a self-signed certificate, choose its certificate file to trust it, then restart Actuality." | **Trust a certificate file…** (same action as Preferences, `07` §7; offers **Restart now**) |
| `tls-expired` | `CERT_HAS_EXPIRED`, `CERT_NOT_YET_VALID` | "The security certificate for {url} has expired or isn't valid yet. Renew the certificate on your server, and check that this computer's date and time are correct." | — |
| `tls-other` | any other `ERR_TLS_*`, `ERR_SSL_*` or `CERT_*` code, or `EPROTO` on an `https://` URL | "Actuality couldn't make a secure connection to {url} ({code})." | — |
| `needs-https` | `http://` URL, and the request fails with `ECONNRESET`, "socket hang up" or an empty reply, **and** the same address with `https://` answers `/info` (any TLS outcome) | "This server only accepts secure connections. Use https:// instead of http://." | **Use https://** (rewrites the address field and retries) |
| `none` | the probe succeeds, or `ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT` / other | the generic "Couldn't reach a server at {url}…" message | — |

Rules:

- The app never offers to skip certificate checks, and never sets `NODE_TLS_REJECT_UNAUTHORIZED` (`02` §6).
- Trusting a certificate file (`NODE_EXTRA_CA_CERTS`) fixes `tls-untrusted` only. It does **not** fix `tls-name-mismatch`; that needs a new server certificate. So after trusting, a reconnect can still produce `tls-name-mismatch`, and the message above then explains why.
- **During an open session**, a TLS failure on `sync()` follows the normal offline flow (§4). **Retry now** runs the diagnosis; it is the reachability probe of §4.2. A non-`none` result is shown once in a TaskDialog with the message above, and the banner stays.
- The diagnosis result and Node error code are logged. Certificate contents are not.
