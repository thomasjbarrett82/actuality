# 18 — Help/About & Wipe the Slate Clean

## 1. Help & About

The Help menu has three sections:

1. **Actuality** submenu, whose items open externally:
   - **Docs** — `https://actualitydesktop.org` (the user guide)
   - **GitHub** — `https://github.com/thomasjbarrett82/actuality`
2. **Actual Budget** submenu, whose items open externally:
   - **Tour** — `https://actualbudget.org/docs/tour/`
   - **Blog** — `https://actualbudget.org/blog/`
   - **Contributions** — `https://opencollective.com/actual`
   - **Discord** — `https://discord.com/invite/8JfAXSgfRf`
   - **Docs** — `https://actualbudget.org/docs/`
   - **GitHub** — `https://github.com/actualbudget/actual`
3. **Keyboard Shortcuts** opens the Keyboard Shortcuts dialog (`06` §6.1, also on `?`); **Notifications…** opens the Notifications dialog, the news feed's release notes and announcements, and is shown only while "Show in-app notifications" is on (`24` §4.6); **Show Logs Folder** opens `{userData}/logs`; **About Actuality** opens the About dialog.

The About dialog ("About Actuality") contains the app icon, the app name with the motto "Potential made actual" right below it (a translatable string, so a locale may render it in its own language), "Version: {version} ({git sha})", the update check's status line right below it (the link "New version available: {version}" to that release's post, "You're up to date!", or nothing while checking, when the version is unknown, or when the check is off; `24` §2.2), a **Release notes** link (`https://actualitydesktop.org/blog/tags/release`, opened externally), "Electron {v} · Chromium {v} · Node {v}", "Actual API {version}", "Connected server: {url} (Actual {serverVersion})" (via `getServerVersion`), a copyright line, "Not affiliated with Actual Budget.", **View licenses** (opens the bundled third-party license file), a **Privacy policy** link (`https://actualitydesktop.org/privacy`, opened externally; the page states what Actuality sends and stores, `02` §5), and **Close**. On macOS, About is also available in the app menu.

### 1.1 Troubleshooting

Actuality has no equivalent of Actual's **Reset budget cache** or **Repair split transactions** (Settings ▸ Advanced settings in Actual web). Its own writes don't produce the problems the repair fixes (`04` §5, `10` §6), and the budget it shows always comes from a server the user can open in Actual web.

It has no **Reset sync** either. A reset replaces the server's sync history with one device's copy and can discard other devices' unsynced changes, so it's left to Actual web. Actual exposes it only as an internal handler, not through `@actual-app/api`. Actuality handles a reset made elsewhere (`file-has-reset`, `03` §9). It resets sync itself only as part of turning on encryption or changing the password (`07` §4). **Clear Offline Cache…** (`03` §2) replaces a bad local copy without touching the server.

When the Actuality docs are published (Help ▸ Actuality ▸ Docs), their troubleshooting page carries these lines:

> If split transactions look wrong, open your budget in Actual's web app and run **Settings ▸ Advanced
> settings ▸ Repair split transactions**. Actuality picks up the fix at its next sync.
>
> If your budget won't sync on any device, open it in Actual's web app and run **Settings ▸ Advanced
> settings ▸ Reset sync**. Actuality will then offer to download it again.

What an orphaned split line (a line whose parent was deleted without it) looks like in Actuality, from the integration test `tests/int/orphan-splits.int.test.ts` (26.11.0):

- The register and account balances leave it out. ActualQL reads live rows through a view that drops lines whose parent is deleted.
- The Budget screen leaves it out too, but only once Actual's budget cache is recomputed. Deleting a parent alone doesn't recompute any category's spending, so the cache can keep counting the lines until then.
- The repair deletes the lines. That changes nothing visible, and the deletes recompute the stale spending when they sync. **Clear Offline Cache…** (`03` §2) also rebuilds the cache.

## 2. Wipe the Slate Clean (File ▸ Wipe the Slate Clean…)

As a noun (in this spec, docs and code) the feature is the **slate wipe** (`slateWipe`).

Requires `canEdit`. A standard dialog (`--dialog-w-lg`, app icon about 5 rem tall):

```text
 [logo]  Start your budget with a clean slate
         Your accounts, scheduled transactions and budget categories will be saved and
         all transactions and budget data will be deleted. This allows you to start
         budgeting from today without having to do all that setup again.

         A backup of your current budget will be saved first.          (bold)
         Save backup to: [ C:\Users\…\My Budget before wipe 2026-10-14.zip ] [Change…]
 [Delete everything before: [ ALL DATES ▾ ]]   ← hidden unless Alt is held/pressed in the dialog
                                                     [Cancel] [Wipe the Slate Clean]
```

- The heading uses the TaskDialog instruction style. **Wipe the Slate Clean** is the default.
- The cutoff combo is **hidden** until the user presses **Alt** ("advanced mode"). It lists "ALL DATES" (default: erase everything), then every month from the current month back to the first month with data. A normal slate wipe therefore erases everything.
- The confirm step: TaskDialog "Are you sure?" / "This deletes {n} transactions and all budgeted amounts{ before {cutoff}}. It can't be undone except by restoring the backup." **Wipe the Slate Clean** / Cancel.
- **Process** (`slateWipe.run`, **one** host job under the "Wiping the slate clean" overlay. The gate (`03` §5.1) is checked once, at the start. Its timeout grows with the number of transactions (`03` §3). On large budgets it can take many minutes. Progress is reported with `job:progress` events, `03` §8):
  1. `exportBudget()` → write the backup zip to the chosen path (X17). Abort if this fails. There is **no** server copy. Uploading the backup would mean `importBudget`, which overwrites the open budget's local cache. Users can restore the zip later with **Import a budget file…** (`07` §3.4), which creates a new server budget.
  2. For each account, remember its working balance through the last day before the cutoff month (0 when erasing everything).
  3. With a cutoff: remember each expense category's balance in the last erased month.
  4. Delete all transactions (or those dated before the cutoff) in batches of 200 through `transactions-batch-update` (the settled write path, `03` §3), with progress text "Deleting transactions… {done}/{total}" after each batch. Deleting one side of a transfer or a split parent also removes its counterparts and children (`04` §3, `10` §8), so a transfer's other side is left out of the batches, and ids that are already gone are skipped, not treated as errors. A transfer whose other side is **kept** (dated on or after the cutoff) would lose that side too, so first the kept side is converted to an ordinary transaction (its payee cleared; Actual then deletes the erased side), and it keeps its date, amount and notes. The counts are rows, as in the confirm step: each split line counts once, and a transfer whose two sides are erased counts twice. On the 1,400-transaction fixture the batches take about 2 s.
  5. Zero all budgeted amounts (`setBudgetAmount(m, cat, 0)` inside `batchBudgetUpdates`, per month) for every month (or before the cutoff), and reset holds (`resetBudgetHold`) in those months. **Carryover flags are left unchanged.** `setBudgetCarryover` propagates to every later month so resetting them would also wipe the kept months' settings.
  6. For each open account, add a **Starting Balance** transaction for the remembered balance (skip when 0 and erasing everything, since the user will reconcile the accounts). Date it the last erased day (or today when erasing everything) and categorize it per `13` §2.1. A closed account gets one only when its remembered balance isn't 0: its kept rows then don't net to zero, and without it the closed account would be left with a balance.
  7. With a cutoff: set each category's budgeted amount in the last erased month to its remembered balance, so balances carry forward.
  8. Sync.
- **Connection lost during the job:** the job keeps going. The gate only guards the start of a job, and in a server session writes made while the server is unreachable are recorded and pushed by the next successful sync (`03` §5.2). The final sync then fails, which sets `unsyncedChanges` and `OfflineReadOnly` as for any write. So a slate wipe is never left half done because of the network. If the job fails for any other reason, the Error dialog below says that the budget may be partly reset and shows the backup path. That includes a host crash or stuck-host restart in the middle of the job: the dialog then appears after the automatic reopen (`03` §6.5 step 5).
- Completion TaskDialog "Welcome to your clean slate" (logo icon, **Close**):
  - erase all: `All transactions and budget data have been deleted. A backup of your old budget was saved to '*{path}*'. You can restore it at any time from that file.<br><br>All that's left to do is update the balances of your accounts. Open each account and reconcile it to enter the current balance.`;
  - with cutoff: `You'll find your list of accounts, scheduled transactions, and categories are just as you left them.\nActuality erased all transactions and budget data prior to {cutoff}.\n<br/>\nA backup of your old budget was saved to: <br/>**"{path}"**`.
- Error: TaskDialog "Error" / "There was an error while wiping the slate clean. Error: {message}"
  - (if any data was already deleted) `<br><br>Your budget may be partly reset. A backup of your old budget was saved to: <br/>**"{path}"**`.
- Acceptance: on the fixture, slate wipe (erase all) leaves 0 non-starting-balance transactions, all budgeted amounts 0, accounts/categories/schedules intact, carryover flags unchanged, and a valid backup zip (it re-imports in a test via `importBudget`). With a cutoff, every month from the cutoff on keeps its budgeted amounts and carryover flags.
