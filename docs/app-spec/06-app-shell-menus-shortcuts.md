# 06 — Application Shell, Window, Menus & Keyboard Shortcuts

## 1. Window

- One main window. Default **1020 × 700** device-independent px (window sizes are the one place px are used, `05` §3.6), centered on the primary display at first run. Size, position and maximized state are remembered (`19` §1 `window`). They're saved on close (not while minimized, and only if larger than 125 × 125). Restored bounds are clamped to the visible displays. Minimum 800 × 560. Background `--app-bg`. Main creates the window with `backgroundColor` set to the current palette's `--app-bg` (the first screen is always a blue-canvas one) and sets `nativeTheme.themeSource` from `appearance` before the window is shown, so dark mode never flashes white (`05` §1.9).
- Title: `"Actuality"`, plus `" - {budget name}"` while a budget is open, plus `" (offline)"` in `OfflineReadOnly` (`" (signed out)"` when `signedOut`, `03` §4). Set by main from the renderer via `shell.setTitle`.
- Closing the window = quit (all platforms; single-window app). Before quitting: §5.
- Single-instance lock. A second launch focuses the existing window. A second launch with a bank file argument hands the path to the import flow (`16` §1.1), if file associations are enabled.

## 2. Layout tree (renderer)

```text
App.vue
├─ ConnectionBanner        (top, 0 or `--bar-h`; only in OfflineReadOnly / Reconnecting / unsynced, 03 §4)
├─ ScreenHost              (slide transition 350 ms between the two canvases)
│  ├─ BlueCanvas           — full-window start screens: Connect, Budget List, Open/Import,
│  │                          Budget Setup / Properties, Loading, Preferences      (07)
│  └─ MainCanvas (flex row)
│     ├─ Sidebar (full height)                                                     (08)
│     └─ PanelHost (white "paper" panel, slight rounded top-left corner and shadow)
│        ├─ WelcomePanel   (no screen selected yet)
│        ├─ BudgetScreen                                                           (09)
│        ├─ RegisterScreen                                                         (10)
│        └─ ReportsScreen                                                          (15)
├─ DialogHost / CalloutHost / TooltipHost / LoadingOverlay                         (17)
├─ Announcer               (visually hidden live regions; 23)
```

- Panel switches slide (350 ms). Budget and Register show a centered loading illustration the first time each is shown (a `status` with the accessible name "Loading…", and `aria-busy` on the panel). The illustration fades out (350 ms, after the first data arrives or 1 s, whichever is later) while the screen fades in (350 ms). Reports owns its query loading, error, and empty states within the panel (`15`, `22`).
- **WelcomePanel**: app logo and "Select Budget, Reports or an account on the left to get started."

## 3. Screens & navigation state

- Pinia `app` store: `screen: 'start' | 'welcome' | 'budget' | 'register' | 'reports'`, `activeAccountId: Id | 'all' | null`.
- Navigation actions: `toWelcome()`, `toBudget()`, `toReports()`, `toAllAccounts()`, `toAccount(id)`.
- `toRegister()` without an account picks the first open account in sidebar order (on-budget accounts first), else All Accounts.
- The current screen is saved per budget/device as `lastScreen`: `"budget" | "reports" | "all" | "account:{id}"`. Use the **id**, not the name (the reference design used names). It is restored on open, falling back to Budget if the account is gone. A saved `"reports"` opens Reports on Summary with default filters (`15`, `19`); `null` → Welcome.
- Navigation is ignored while the current screen has `busy` true (first load in progress). A register edit in progress is handled first (`11` §1: an unchanged edit is cancelled, a changed edit is committed through the commit pipeline, and navigation stops if that fails or is cancelled).

## 4. Menus (Electron native `Menu`)

Built in `main/menu.ts` from a declarative template. Labels are i18n keys, translated in main with the shared `t()` (`20` §3.4), and the menu is rebuilt when `language` changes. Enabled/visible state is pushed from the renderer (`shell.setMenuState({...})`) whenever the relevant state changes. Clicks are sent to the renderer as `menu:command` `{ id }` and handled by a central command dispatcher (also used by shortcuts). On Windows and Linux, main lays the menu bar out again after every rebuild, unless the bar is hidden: at fractional display scales the rebuilt buttons are otherwise one device pixel taller than the bar, which leaves a step under the menu items.

macOS adds the app menu ("About Actuality", "Settings…" ⌘,, Services, Hide ⌘H, Hide Others, Show All, "Quit Actuality" ⌘Q) and a standard **Window** menu. On macOS, File ▸ Preferences/Exit are omitted. About is also available from the app menu.

### File

| Item | Shortcut | Enabled | Action |
| --- | --- | --- | --- |
| Create a New Budget… | | `SignedIn`, or a budget open with `canEdit` (`03` §4) | Budget Setup (`07` §4) |
| Open… | Ctrl+O | app ready | Budget List screen (`07` §3) |
| — | | | |
| Sync Now | Ctrl+S | budget open | `session.syncNow()` (X9) |
| Export Budget Backup… | | budget open | save dialog → `budgetFile.exportBackup(path)` (X5, `07` §6) |
| Wipe the Slate Clean… | | budget open & can edit | `18` §2 |
| — | | | |
| Import Transactions from Your Bank… | Ctrl+I | budget open & can edit | `16` §1 |
| — | | | |
| Budget Properties… | | budget open | `07` §4 (opens read-only when offline, `03` §5.3) |
| — | | | |
| Export… | Ctrl+E | budget open | `16` §2 |
| Print… | Ctrl+P | budget open | `16` §3 |
| — | | | |
| Close Budget | | budget open | close flow (`03` §5.4) → Budget List |
| — | | | |
| Preferences… | Ctrl+, | Windows/Linux | `07` §7 |
| — | | | |
| Exit | (Alt+F4 by OS) | Windows/Linux | §5 |

### Edit

| Item | Shortcut | Action |
| --- | --- | --- |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z | `role: 'undo'/'redo'` — text fields only (app-level undo is the register Undo notifier, which Ctrl+Z outside a text field also performs while it shows, `10` §5) |
| Cut / Copy / Paste / Select All | Ctrl+X / C / V / A | standard roles on the focused control (Ctrl+A in the register grid: `10` §9) |
| — | | |
| Rename Account, Edit Account Note, Close Account / Re-open Account | | visible only when the Register shows a single account; act on it as in `13` §3–4 (the account header's Rename and Notes buttons and ⋯ menu) |

### View

| Item | Shortcut | Action |
| --- | --- | --- |
| Go to Accounts | Ctrl+T | register of the active account (nothing if none, or it's closed and hidden) |
| Go to Budget | Ctrl+B | Budget |
| Go to Reports | Ctrl+R | Reports |
| Go to Payee Settings | Ctrl+Y | Payee Settings dialog (pre-selects the payee of the selected register transaction) |
| Go to Rules | Ctrl+U | Rules dialog (`23` §2) |
| — | | |
| Collapse/Expand Sidebar | | toggles `08` §1 compact mode |
| Privacy Mode | Ctrl+Shift+P | checkbox item, checked while on; toggles privacy mode (§7). Enabled with a budget open. |
| Appearance ▸ | | submenu of radio items **"Use System Setting"**, **"Light"**, **"Dark"** (`appearance`), a separator, then the checkbox item **"Color-Blind Friendly Colors"** (`colorVision`). Always enabled; changes apply immediately (`05` §1.9). |
| Zoom In / Zoom Out / Actual Size | Ctrl+= (also Ctrl+Shift+=, Ctrl+numpad +) / Ctrl+- / Ctrl+0 | zoom factor 80–200% in 10% steps, saved as `zoomFactor` (`22` §5) |
| Toggle Full Screen | Ctrl+Cmd+F (mac) / F11 | `role: 'togglefullscreen'` |
| (dev builds only) Toggle Developer Tools | Ctrl+Shift+I | |

All Go to items are enabled only with a budget open. **Ctrl+R must not reload the window**: remove Electron's default reload accelerators.

### Help

| Item | Action |
| --- | --- |
| **Actuality** ▸ Docs / GitHub | reserved links; disabled until published |
| — | |
| **Actual Budget** ▸ Tour / Blog / Contributions / Discord / Docs / GitHub | opens the official Actual Budget pages in the browser: `https://actualbudget.org/docs/tour/`, `https://actualbudget.org/blog/`, `https://opencollective.com/actual`, `https://discord.com/invite/8JfAXSgfRf`, `https://actualbudget.org/docs/`, `https://github.com/actualbudget/actual` |
| — | |
| Keyboard Shortcuts | opens the Keyboard Shortcuts dialog (§6.1); `?` does the same |
| Show Logs Folder | opens `{userData}/logs` |
| About Actuality | opens the About dialog |

## 5. Quit / close flow

Main runs steps 1–2 by asking the renderer, and only while the loaded page listens for close requests. If the page failed to load, is reloading or has crashed, closing the window goes straight to step 3, so the window can always be closed. Steps 3–4 always end in quitting: a step that fails is logged, and the rest still run.

1. If a register edit has unsaved changes, ask via the commit pipeline (`11` §6). A failed or cancelled commit cancels the quit.
2. If `unsyncedChanges`: the `03` §5.4 dialog.
3. Save window bounds and device settings (`19`).
4. Main sends `app:quit` to the host over the control channel (`02` §4.1), and the host runs `shutdown()` and replies. Then quit. If `clearCacheOnExit` (and no unsynced changes), delete `actual-cache/`, and remove `localId` and `lastSyncAt` from every budget's device settings, as Clear Offline Cache does (`03` §2).

## 6. Keyboard handling

- **Native menu accelerators** cover the menu items above (`CmdOrCtrl+…`).
- **In-app dispatcher** (`renderer/keyboard/`): a single `keydown` listener on `window` (capture phase) routes keys to the active screen's handler stack. Components register handlers while mounted and focused. Rules:
  - While any modal (TaskDialog/standard dialog) is open, screen handlers and in-app shortcuts are suppressed. Only the modal handles keys.
  - While a callout is open, Esc closes it first.
  - Typing in a text field doesn't trigger single-key shortcuts (e.g. `L` toggles cleared only when focus is in the register grid, `10` §9).
- Screen key tables: Register `10` §9, Budget `09` §7, Editor `11` §9.
- Region cycling (F6 / Shift+F6), context menus from the keyboard (Shift+F10 / Menu key), the keys for the sidebar and timeline, and the drag alternatives are in `22` §2.
- Where Actuality has the same function as Actual, it uses Actual's key for it, so people moving from Actual keep their habits. The exceptions are keys an Actuality menu already uses for something Actual doesn't have here: Ctrl+B is Go to Budget (Actual: bank sync), Ctrl+K isn't used (Actual: command palette), Ctrl+P is Print, the usual print key on every OS (Actual: privacy filter, which is Ctrl+Shift+P here), and Ctrl+R is Go to Reports (Actual's desktop app: reload).

### 6.1 Keyboard Shortcuts dialog

Opened by `?` anywhere outside a text field (with no Ctrl, Alt or Cmd) and by Help ▸ Keyboard Shortcuts. A `StandardDialog` (`17` §1), width `lg`, height 36 rem (capped by the window), titled "Keyboard Shortcuts", with one **Close** button.

- **Content:** the shortcuts worth discovering, in four sections with headings: "General" (the `?` key, the menu shortcuts of §4 with an accelerator, F6 and Shift+F10; not Cut/Copy/Paste/Select All, the macOS app menu's standard keys or the dev-only Developer Tools), "Budget" (`09` §7, `22` §2.3), "Register" (`10` §9) and "Editing a transaction" (`11` §9). Each section is a table: what the shortcut does (a row header), then its keys. Alternative combinations are joined by "or"; the keys of one combination are keycaps joined by "+". The list lives in `renderer/keyboard/shortcut-list.ts`; a key change updates it along with the key table.
- **Key names:** Ctrl shows as "⌘" on macOS and Alt as "Option"; Shift, Enter, Tab, Esc, Delete and the numeric keypad's plus ("Num +") are translated (`shortcuts` bundle). Letters show as capitals, as on a keycap; arrows as ← → ↑ ↓. A shortcut whose keys differ on macOS by more than ⌘ for Ctrl shows the macOS keys there (Toggle Full Screen: ⌃+⌘+F, elsewhere F11), with the Control key as "⌃".
- **Search:** a search field at the top ("Search shortcuts", which is also its accessible name) stays in view while the list scrolls. It narrows the rows to those whose description or keys contain the typed text, case-insensitively (so "shift+p" finds Privacy Mode), and hides empty sections. With nothing left: "No shortcuts match your search." as a status.
- It is read-only: the shortcuts can't be changed.

## 7. Privacy mode

A display-only toggle for screen sharing. While it's on, every visible money amount in the app is replaced by a squiggly-line glyph, so the user can share their screen without showing their balances.

- **State**: the `privacyMode` app preference (`19` §1), a bool that defaults to false. It's per device, persists across restarts and budgets, and is never synced. The renderer holds it in the Pinia `app` store, applies it to all windows' content immediately, and saves it through `shell.settings.set`.
- **Controls**: the eye button in the sidebar's bottom controls (`08` §2.4) and View ▸ Privacy Mode (Ctrl+Shift+P). Both reflect the same state. The button's **tooltip** is "Enable privacy mode" when off and "Disable privacy mode" when on. Its **accessible name** is the fixed "Privacy mode" with `aria-pressed`, so a screen reader says "Privacy mode, toggle button, pressed" and the label doesn't contradict the state. Toggling from the menu or the shortcut announces "Privacy mode on" / "Privacy mode off" through the live region (`22` §4); the button's own state change is announced by the screen reader, so the button doesn't add a second announcement.
- **What is masked**: every money amount rendered by the UI, formatted through `shared/money.ts`. That covers sidebar account balances and badges that show amounts, budget screen columns and header summaries (Available to Budget, Budgeted, Spent, Balance, month totals), the register (Payment, Deposit, Balance columns, split rows, the editor's displayed amounts, reconciliation and statement balances, the status line), scheduled transactions, dialogs, popovers and tooltips that show amounts, and the printed output (`16` §3).
- **Implementation**: one shared `<MoneyAmount>` display component (not `<Money>`, which would clash with the `Money` type in every file that uses both), backed by `formatMoneyDisplay(m, settings, opts)` in `shared/money-display.ts`, is the only way the renderer shows an amount. It renders the mask instead of the text when `privacyMode` is on. Components never test the flag themselves. Text that can't hold the mask glyph (messages, tooltips, print) takes it from the same helper through `renderer/money-display.ts`: `moneyText` gives a fixed squiggle text (`∿∿∿∿`), `moneyLabel` gives "Hidden amount" for accessible names and announcements. Amount fields use `useMaskedField(text)` from the same file.
- **No reveal**: there is no hover or focus reveal of a masked display value, and no per-value override. (Actual's original request, `actualbudget/actual#1041`, proposed revealing on hover. Actual shipped a full mask instead, and Actuality follows the shipped behavior, which is safer for screen sharing.) To see a value, turn the mode off.
- **The mask** is a fixed decorative squiggly-line SVG drawn with `currentColor`, vertically centered, in the same alignment and roughly the same width as the amount it replaces (it keeps the column's right alignment). Its width doesn't depend on the value, so the digit count can't be inferred. Masked values have `aria-label="Hidden amount"` (`a11y` bundle), and the real value is never in the DOM text, `title`, `aria-*` attributes or tooltips while the mode is on.
- **Amount fields** (the editor's Payment and Deposit, Hold, the reconciliation statement balance, a new account's balance) show the mask text until the user edits them, including when they open pre-filled with a balance. Focus alone doesn't reveal a field, because dialogs and the editor focus an amount field as they open. A click in the field or a key pressed in it (other than Tab, Esc and modifier keys) reveals the real text, before the key acts; if the whole mask was selected, the whole amount is, so typing replaces it. Leaving the field masks it again. A masked field's accessible description is "Hidden amount". Editing a field isn't the reveal ruled out below. The Budgeted cell's input exists only while it's being edited, so it's always unmasked.
- **Not masked**: the text of an amount field that has focus, because the user is entering their own data. Export files (`16` §2) and backups are data, not display, and always contain the real values. The export and print dialogs don't change. The user can still select and copy a masked cell: the clipboard gets nothing for it.
- **Editing and budgeting** keep working normally while the mode is on. Nothing is sent to the host differently, and the write gate and `useCanEdit()` (`03` §4) are unaffected.
- **Logging**: log lines never include amounts, so privacy mode has no effect on them (`02` §8).

Acceptance: with privacy mode on, no digit that belongs to a money amount appears on the Budget, any Register, the sidebar, a dialog or a tooltip, and turning it off restores every value without reloading data. The setting survives an app restart.
