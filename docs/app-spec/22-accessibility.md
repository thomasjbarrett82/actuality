# 22 — Accessibility

Actuality must be usable with a keyboard alone, with a screen reader, at high zoom and with reduced motion. This chapter sets the target, the keyboard model, focus rules, screen-reader semantics and the tests. Feature chapters describe mouse behavior; this chapter adds the keyboard and assistive-technology side of every screen. Color and contrast rules are in `05` §1.9–1.10.

## 1. Target

- **WCAG 2.2 level AA**, applied to a desktop app. Every deliberate exception is listed in §8, with its reason and the equivalent the app offers. Anything not listed there must meet AA.
- **Screen readers:** NVDA with Windows (primary), VoiceOver with macOS, and Orca with Linux (best effort: smoke-tested, not blocking).
- Electron enables Chromium's accessibility tree when a screen reader is running (`app.accessibilitySupportEnabled`). The app never turns it off.
- Native menus, native file dialogs and the OS print dialog are accessible through the OS. Everything else the app draws must follow this chapter.
- All accessible names, descriptions and announcements are i18n keys in the `a11y` bundle (`20`). The English text quoted here is the source.

## 2. Keyboard

Everything the mouse can do, the keyboard can do. Existing key tables stay in force: register `10` §9, budget `09` §7, editor `11` §9, dialogs `17` §1. This section adds what they don't cover.

### 2.1 Regions

The window is divided into **regions**. **F6** moves focus to the next region and **Shift+F6** to the previous one, wrapping round. Focus lands on the region's last focused element, or its first one.

| Screen | Region order |
| --- | --- |
| Main canvas | Sidebar → panel toolbar (timeline, search, filters) → panel content (budget grid, register grid, or Reports tab panel) → panel footer (register summary) → scheduler pane (when open) → connection banner (when shown) → messages (the toast stack, while it holds a toast, `24` §5) |
| Blue-canvas screens (`07`) | The screen, then messages (while the toast stack holds a toast); otherwise one region, Tab order only |
| Modal dialog | No regions; F6 does nothing (focus stays trapped, §3) |

Within a region, Tab and Shift+Tab move between controls, and arrow keys move inside composite widgets (grids, lists, trees, radio groups), which take a single Tab stop (roving `tabindex`).

### 2.2 Global keys

| Key | Action |
| --- | --- |
| F6 / Shift+F6 | next / previous region (§2.1) |
| Shift+F10, or the Menu key | context menu of the focused item: the same menu as a right-click |
| Ctrl+= (also Ctrl+Shift+= and Ctrl+numpad +) / Ctrl+- / Ctrl+0 | zoom in / out / actual size (§5) |
| Esc | close the innermost callout, popup or menu; in a grid with nothing open, cancel the current edit (`11`) |
| Alt (Windows/Linux) | focus the native menu bar (OS behavior) |
| ? (not in a text field) | the Keyboard Shortcuts dialog (`06` §6.1) |

### 2.3 Per area

| Area | Keys |
| --- | --- |
| **Sidebar** (`08`) | A tree. ↑/↓ move between section buttons, group headers and accounts. ← collapses a group (or moves to its header); → expands it. Home/End: first/last item. Typing letters jumps to the next item starting with them. Enter or Space opens the item. Alt+↑/↓ moves the focused account up or down within its group (§2.4). Shift+F10 opens the account menu, the same as a right-click (`08` §2.2): **Rename Account**, **Edit Account Note**, **Close Account** / **Re-open Account**, **Move Up**, **Move Down**. The compact-mode toggle and Add Account are ordinary buttons after the tree. |
| **Budget: timeline** (`09` §3) | A single Tab stop. ←/→ move the selected month, Home/End jump to the first/last month in range. The prev/next arrow buttons are reachable too. |
| **Budget: month header** (`09` §5) | The "= amount" and label toggle is a button (Enter/Space). The month menu and Quick Budget icons are menu buttons (Enter/Space/↓ opens). |
| **Budget: grid** (`09` §4–5) | A tree grid (§4.2). ↑/↓ move between rows; ←/→ move between cells in a row, and on a group's name cell ← collapses and → expands. Enter on a category or group name opens its edit callout; on a Budgeted cell it starts editing (`09` §7); on an Outflows value it opens the transactions callout (`09` §6.6); on a negative Balance it opens Overspending Settings. Every other click action on a cell is also on Enter. Shift+F10 opens the row menu: **Edit…**, **Note…**, **Hide**, **Move Up**, **Move Down**, **Move to Group…** (categories; groups get Move Up/Down only). Alt+↑/↓ moves the row (§2.4). Ctrl+← collapses all groups, Ctrl+→ expands all. |
| **Register: account header** (`10` §1, `13` §3–4) | The start of the toolbar region, before the notifier strip. Tab reaches the **Notes** button, the **Rename** button and the **⋯** menu button, in that order. The Notes and Rename buttons are always in the tab order: they appear on hover and also whenever they or the header have keyboard focus. In the rename input, Enter saves and Esc cancels; both return focus to the Rename button. After a validation error dialog, focus returns to the input. The ⋯ button is a menu button (Enter/Space/↓ opens). Offline, the buttons stay focusable with `aria-disabled="true"` so their tooltip can be read (§4.6). |
| **Register** (`10`) | `10` §9 applies. In addition: on a column header, Enter sorts, Shift+Enter adds or changes a sort level (multisort, `10` §2) and Shift+F10 opens the column chooser; on a split row, → expands and ← collapses its lines; tag pills are buttons that filter by their tag; the notifier strip is the start of the toolbar region, and each notifier (including Undo) is a button; the footer summary boxes are buttons. |
| **Scheduler pane** (`12`) | The same grid keys as the register, including Shift+F10 on a column header for the column chooser. Its splitter is focusable (§2.4). |
| **Reports** (`15`) | The tab list uses manual activation: Left/Right move focus between tabs, Home/End move to the first/last tab, and Enter/Space activates the focused tab. Filters, report options, saved-filter controls, and expandable table rows are keyboard-operable. Each chart is one Tab stop: ←/→ and Home/End move a focused position whose tooltip lists every series' value there, and Esc or leaving the chart hides it. The adjacent data table provides full chart values; chart legends and marks are not the only way to access data. |

### 2.4 Alternatives to dragging

Every drag has an equivalent that doesn't need a pointer (WCAG 2.5.7). The results are the same as the drag, with the same rules, confirmations and offline blocking.

| Drag (spec) | Keyboard / menu equivalent |
| --- | --- |
| Reorder accounts (`08` §4) | Alt+↑/↓ on the account; **Move Up** / **Move Down** in its menu |
| Reorder categories within a group, or groups (`09` §4.3) | Alt+↑/↓ on the row; **Move Up** / **Move Down** in its menu. At the top or bottom of a group, a category doesn't cross into the next group. |
| Move a category to another group (`09` §4.3) | **Move to Group…** opens a picker dialog listing the groups (the same refusals as a drop) |
| Resize the category column (`09` §1) | The grabber is a focusable `separator`: ←/→ change the width by 1 rem, Home/End set the minimum/maximum |
| Resize the scheduler pane (`10` §1) | Its splitter is a focusable `separator`: ↑/↓ change the height by 1 rem |

## 3. Focus

- **Always visible.** The focused element shows the 2 px `--focus-ring` outline whenever focus came from the keyboard (`:focus-visible`). On the blue `--app-bg` (sidebar, blue-canvas screens) the outline is `--text-on-blue`, because `--focus-ring` doesn't show on blue (`05` §1.1). Under `forced-colors` it uses the system `Highlight` color. No component removes the outline.
- **Never hidden.** The focused element is never covered by sticky content (WCAG 2.4.11). Grids with sticky parts (the budget's header and totals rows and category column, and the register's header row) set `scroll-padding` on the scroll container equal to the current size of their sticky areas, and focused cells set `scroll-margin`, so keyboard moves scroll the focused cell clear of them. The values are recomputed when the header expands or collapses and on zoom. The connection banner takes space in the layout rather than overlaying it.
- **Never lost.** If the focused element disappears (a row deleted, a callout closed, a panel switched), focus moves to the place named below, never to `<body>`.
- **Modal dialogs** (`17` §1–2): focus moves into the dialog (to the element `17` names: the default button, the first command link or the first field) and is trapped there. On close, focus returns to the element that opened it; if that element is gone, to the selected row of the grid, else to the panel heading.
- **Callouts** (`17` §3): on open, focus moves to the first field, or to the callout itself when it has none. While open, Tab cycles inside it. Esc and Done/Cancel close it and return focus to the anchor. A click outside closes it as before, and focus goes to whatever was clicked.
- **Screen changes** (`06` §3): after a panel switch, focus moves to the new panel's heading (§4.1).
- **Account actions:** closing the note popover returns focus to the Notes button (the callout rule above). After **Close Account**, focus goes to the ⋯ button, which now offers Re-open. When the close or a force close deletes the account, the panel switches to the account selected next (`08` §2.3) and focus moves to its heading. **Rename Account** and **Edit Account Note** started from the sidebar or the Edit menu move focus into the register's header (the rename input, or the note popover) once the register opens.
- **Deletes and moves:** after deleting or moving rows, focus goes to the row that took the first removed row's place, or the previous row if the list ended there.
- **Editor:** committing or cancelling an inline edit returns focus to the edited row (unless `11` sends it to the next new-transaction editor).
- **Unprompted changes don't move focus.** The connection banner, notifiers, sync results and data refreshes never take focus. They are announced instead (§4.5).
- **The loading overlay** (`17` §6) doesn't take focus. Focus stays where it was and input is blocked until it closes.

## 4. Screen readers

### 4.1 Structure

- Landmarks: the sidebar is `<nav>` named "Accounts and budget"; the panel is `<main>`; the panel toolbar, footer and scheduler pane are `region`s named "Toolbar", "Summary" and "Scheduled transactions"; the connection banner is a `region` named "Connection".
- Each panel has one `<h1>`: "Budget", the account name (or "All Accounts"), or "Reports" (`15`). When the design shows no heading, it is visually hidden but present. For a single account, the `<h1>` is the name in the account header (`10` §1); while it's being renamed, the input replaces the name's text inside the heading. The Reconciling title (`10` §7.3) isn't a heading: it's plain text, and its appearance is announced (§4.5).
- Reports is a `<main>` region labelled by its "Reports" `<h1>`. The heading is programmatically focusable (`tabindex="-1"`) and receives focus when Reports is opened or restored; it is not an extra Tab stop. The report area exposes explicit loading (`aria-busy`), error, and empty states, with async changes announced (§4.5).
- Each chart has an accessible name and concise description; its adjacent table exposes the same data in full. Series have a label and non-color cue. Tooltips supplement the table and are available on keyboard focus as well as pointer hover. Privacy mode also masks chart accessible text and descriptions (`06` §7, `15` §7–8).
- Blue-canvas screens have an `<h1>` with the screen title (`07`).
- The window title (`06` §1) is also kept current; screen readers read it on window focus.

### 4.2 Grids

| Grid | Role | Rules |
| --- | --- | --- |
| Register (`10`) | `treegrid` | Virtualized, so the grid sets `aria-rowcount` to the full number of rows and each rendered row its `aria-rowindex`. Headers are `columnheader`s with `aria-sort` on the primary sort key's header (the other keys' headers carry an `aria-description` with their level, `10` §2). Selected rows have `aria-selected="true"`; the grid is `aria-multiselectable`. Transactions are `row`s with `aria-level="1"`; split rows have `aria-expanded`, and their lines are `row`s with `aria-level="2"`. It's a `treegrid` because ARIA allows those two attributes on rows only there. The editor row is labelled "Editing transaction". |
| Scheduler (`12`) | `grid` | As the register's, without split rows: the pane doesn't expand split lines (`12` §3). |
| Budget (`09`) | `treegrid` | Group rows are `aria-level="1"` with `aria-expanded`; category rows `aria-level="2"`. Each month column's cells are labelled with the month as part of the column header ("January Budgeted"). Uncategorized and Hidden Categories rows are ordinary rows with their names. |

Cell content is read as its text plus the state that the visuals carry: "Overspent", "Needs a category", "Error: …", each tag name (for example, "#Vacation2025"), "Cleared", "Reconciled", "Needs approval", "Scheduled".

### 4.3 Names and values

- **Icon-only controls** have an accessible name from the `a11y` bundle: cleared cell ("Cleared" / "Uncleared" / "Reconciled"), note icon ("Note" / "Add note"), Quick Budget ("Quick Budget"), search clear ("Clear search"), error icons ("Error", "Needs a category", "Needs approval"), the connection indicator (its label from `08` §2.4), the privacy mode toggle (the fixed name "Privacy mode" with `aria-pressed`; its tooltip alone changes between "Enable privacy mode" and "Disable privacy mode"), the server web link ("Connect to {url} web", the same as its tooltip, `08` §2.4), the notifications bell ("Notifications", or "Notifications: {n} unread" with the real count, the same as its tooltip; its badge is hidden, `24` §4.5), a toast's close button ("Close"). Masked amounts are named "Hidden amount", and a masked amount field gets that as its accessible description, so a screen reader doesn't read out the mask text (`06` §7). Each tag pill's accessible name is "Filter by tag {tag}".
- **Badges:** the sidebar badge is read as the tooltip text ("There are 3 transactions that require your attention."), not the bare number.
- **Amounts** are shown without a currency symbol in grids (`09`, `10`). Their accessible name is the full format with symbol and sign (`format(m, {symbol: true, sign: true})`, `04` §1), so "-50.00" reads as "-$50.00". A negative category balance adds ", overspent"; a negative Available to Budget is read with its label ("Overbudgeted").
- **The month header** is read as one group: "{Month} {Year}. Not budgeted in {Prev}: {amount}. Overspent in {Prev}: {amount}. Income for {Month}: {amount}. Budgeted in {Month}: {amount}. Available to Budget: {amount}." (the same lines and wording as `09` §5.1, in order).
- **Truncated text** (`20` §3.6; sidebar and category names) has the full text as its accessible name.

### 4.4 Component patterns

Each common component (`17`) follows the WAI-ARIA Authoring Practices pattern below.

| Component | Pattern |
| --- | --- |
| `UiButton`, `UiSmallButton`, `UiLink`, `UiChunkyButton` | button (links that navigate are `link`) |
| `UiMenuButton`, Edit Transactions ▾, filter buttons | menu button: `aria-haspopup`, `aria-expanded`; native context menus where `09`/`10` already use them |
| `UiSegmented` | radio group |
| TaskDialog, standard dialogs | `alertdialog` (TaskDialog warnings/errors) or `dialog`, `aria-modal="true"`, named by the title, described by the content |
| `Callout` | non-modal `dialog`, named by its title (or its anchor's name) |
| Help callout | non-modal `dialog` named by its title |
| `AutoComplete` (payee, category) | combobox with a `listbox` popup; `aria-activedescendant` follows the highlighted item; group headers are `group`s |
| `MoneyInput` | text field labelled by its column ("Outflow"); the calculator result is announced (§4.5) |
| `DateField` | text field + a button ("Choose date"). A calendar dialog opens when the user enters the field and the button toggles it (`11` §3). Its days are a `grid` (arrow keys move by day/week, PageUp/PageDown by month, Shift+PageUp/PageDown by year, Home/End to the configured week's start/end, using the budget's `firstDayOfWeekIdx` or the UI locale when unset; `07` §4); its arrow buttons are "Previous month", "Next month", "Previous year", "Next year" |
| `MonthPicker` | combobox with a listbox |
| `Calculator` | `dialog` named "Calculator"; its display is a `status` region. Keys whose label is a symbol are named: "Clear" (C), "Change sign" (+/-), "Backspace" (<--), "Divide", "Multiply", "Subtract", "Add", "Equals", "Decimal point" |
| Tooltip directive | `aria-describedby` on the target (§4.6) |
| `ErrorBadge`, `Notifier` | text with a name (§4.3); notifiers' links are buttons |
| Sidebar | `tree` named "Accounts", with `treeitem`s (§2.3): section buttons and group headers at `aria-level` 1, accounts at 2. One Tab stop (roving `tabindex`). An account's name is its visible label, then (visually hidden text) "{working balance in full}" and its badge text when it has one (§4.3); there is no `aria-label`, so the name always contains the visible words |
| Account header (`13` §3) | The Notes and Rename icon buttons are named "Account notes" and "Rename account"; when the account has a note, the Notes button is described by it (`aria-describedby`). The rename input is a text field labelled "Account name". The ⋯ button is a menu button named "Account actions" whose menu has **Close Account** or **Re-open Account** |
| Timeline | `slider`-like single Tab stop: `role="listbox"` of months with `aria-selected` on the selected month |
| `ConnectionBanner` | `region` (§4.1) with its text and button; changes announced (§4.5) |
| `LoadingOverlay` | `aria-busy="true"` on the panel while shown; its label announced (§4.5) |
| Toast stack (`24` §5) | a `region` named "Messages" while it holds a toast; each toast a `group` named by its title, with its action and close buttons. Never takes focus; inert under a modal; Esc inside a toast closes it and returns focus to where it came from |
| Notifications dialog (`24` §4.6) | a standard dialog; each entry an `article` named by its `h3` title, with headings in its Markdown demoted to `h4`–`h6`; "Unread" as visually hidden text; the "Show all changes" disclosure has `aria-expanded` and `aria-controls`; the list area has `aria-busy` while loading |

### 4.5 Announcements

A single **announcer** (`renderer/a11y/announcer.ts`, mounted once in `App.vue`) owns two visually hidden live regions, `polite` and `assertive`. Components call `announce(key, params, politeness)`. The same message is not repeated within 2 s.

| Event | Politeness | Text (English source) |
| --- | --- | --- |
| Connection lost (`OfflineReadOnly`) | assertive | "You're offline. Changes are disabled until Actuality reconnects." |
| Signed out / sign-in needed | assertive | the banner or modal text (`03` §4) |
| Back online | polite | "Connected. Changes are enabled again." |
| Sync Now (user-started) finished | polite | "Synced." |
| Transaction saved / added | polite | "Transaction saved." / "Transaction added." |
| Rows deleted or moved | polite | the notifier text (`10` §5), e.g. "2 Transactions have been deleted", plus "Undo is available in the notifier." |
| Search applied (after 500 ms idle) | polite | "Showing {n} transactions." / "No transactions match." |
| Budget cell committed | polite | "{Category}: budgeted {amount}, balance {amount}. Available to Budget {amount}." |
| Calculator or MoneyInput result | polite | the computed amount |
| Validation error | assertive | the error callout text (`11` §3) |
| Loading overlay shown / closed | polite | its label (`17` §6) / "Done." |
| Reconciliation started | polite | the Reconciling title, "Reconciling {account}..." (`10` §7.3) |
| Reconcile difference changes | polite | "Difference: {amount}." |
| Report loading, refreshed, empty, or failed | polite for loading/refresh/empty; assertive for failure | the active report's localized state and retry instruction (`15` §7) |
| Report filters applied / linked filters restored | polite | localized confirmation describing the active report and applied state |
| CSV or Print completed / failed | polite for completion; assertive for failure | localized status with the destination or recovery action (`15` §7) |
| A toast appears (`24` §5) | polite | its title and message |
| Notifications dialog loaded, empty or failed (`24` §4.6) | polite | "{n} notifications.", "Nothing new to show yet.", or its error text |

TaskDialogs announce themselves as dialogs and aren't sent to the announcer.

### 4.6 Tooltips

The custom tooltip directive (`17` §4) meets WCAG 1.4.13:

- It also shows on keyboard focus (after the same 650 ms) and hides on blur.
- Esc hides it without moving focus.
- It stays open while the pointer is over the tooltip itself.
- Its text is linked to the target with `aria-describedby`, so screen readers read it without it being shown.
- Information that appears only in a tooltip (a truncated label, a badge's meaning) is also in the target's accessible name or description.

## 5. Zoom, text and targets

- **View ▸ Zoom In / Zoom Out / Actual Size** (`06` §4; keys in §2.2) set the window's zoom factor, from 80% to 200% in 10% steps. Saved per device as `zoomFactor` (`19` §1). The OS text-size setting is honored where Chromium follows it.
- All sizes are `rem` tokens (`05` §2–3), so zoom and the default font size scale text and layout together. Every layout works up to 200% in the default window (1020 × 700, so 510 × 350 CSS px at 200%): minimum sizes give way when space runs out (`05` §3.3, `07`, `10` §1), and panels scroll vertically rather than clip. At 150% and above, the sidebar switches to compact mode automatically (without changing the saved `sidebarExpanded`). Its toggle still works there: it shows the state on screen, expanding overrides the automatic compact mode until the zoom drops below 150% (saving `sidebarExpanded` only if it was off), and collapsing returns to it. Grids may scroll horizontally; that is allowed for two-dimensional data (WCAG 1.4.10). Dialogs and callouts scroll inside themselves if they don't fit.
- Text spacing: overriding line height to 1.5, letter spacing to 0.12 em and word spacing to 0.16 em loses no content (labels truncate with full-text names, §4.3).
- **Target size:** interactive targets are at least 24 × 24 CSS px, counting padding. Small icons in rows (cleared, note, Quick Budget) and icon buttons (`05` §3.2) get a hit area of at least `--hit-min` (`05` §3.4). Grid rows and clickable list rows are `--row-h` (24 px at 100%), and clickable rows and controls never go below `--hit-min` whatever the root font size, so targets meet the minimum.

## 6. Motion and timing

- `prefers-reduced-motion` turns off all animations (`05` §3), including panel slides, the timeline indicator and the auto-scroll during drags. The one exception is the loading spinner (`05` §5): it runs three times slower (a 3 s rising fill, then a fade), so a load still shows progress. It never moves or flashes.
- Nothing that holds keyboard focus closes on a timer. A callout with `closeOnRollOut` (`17` §3) doesn't close while focus is inside it.
- Toasts (`24` §5) have no timer: each stays until it is closed or removed.
- Notifiers (`10` §5) have no timer. The Undo notifier hides on the events `10` §5 lists; moving keyboard focus to it (F6 into the toolbar region, then Tab) doesn't hide it.
- No session timeouts in the UI. Server sign-in expiry is handled by the sign-in modal (`03` §7), which is a normal dialog.

## 7. Testing

| Test | Tool | Scope | When |
| --- | --- | --- | --- |
| Component a11y | Vitest + `vitest-axe` | every common component (`17`) in each of its states: no axe violations at WCAG 2.2 A/AA | every commit |
| Screen a11y | Playwright `_electron` + `axe-core` (injected with `evaluate`, so the renderer's CSP doesn't block it; `tests/e2e/a11y.spec.ts`) | every screen, dialog and callout reached in the E2E journeys (`21` §3), in Light and Dark: no violations at WCAG 2.2 A/AA. A dialog is audited on its own; the page behind it is audited as a screen | CI Linux nightly + before release |
| Keyboard-only journeys | Playwright `_electron` | each critical journey (`21` §3) repeated with keyboard input only, plus the drag alternatives (§2.4) and F6 cycling | CI Linux nightly + before release |
| Focus rules | Vitest component tests | §3: trap and return for dialogs and callouts, focus after delete, never on `<body>` | every commit |
| Announcer | Vitest | each §4.5 event produces its message once, with the right politeness | every commit |
| Zoom | Playwright screenshots | Budget, register (with the scheduler pane open), a blue-canvas screen and a dialog at 200%, default window size: no clipped controls, no horizontal page scroll outside grids | before release |
| Target size and sticky focus | Playwright `_electron` | axe-core's `target-size` rule (WCAG 2.5.8: 24 × 24 CSS px, or the spacing exception) passes on every audited screen at 100% zoom, and boxes under 24 px are listed for review in the test's annotations (native checkboxes and radios, the cleared and disclosure buttons, and the budget header's links rely on the spacing exception); arrowing through the budget and register grids at 100% and 200% never leaves the focused cell under a sticky area | CI Linux nightly + before release |
| Manual screen-reader pass | NVDA + Windows, VoiceOver + macOS (Orca + Linux smoke) | the script below | before each release (`21` §7) |

**Manual script:** open a budget; read the month header; budget a category and hear the announcement; move a category with Alt+↓; open an account; add a transaction with a new payee and a split; approve an imported transaction; reconcile; delete a row and undo; open Reports and hear its heading and Summary values; navigate all tabs, operate filters and expandable tables, inspect chart data via the adjacent table, load a saved-filter override and return to linked filters, and verify loading/error and export announcements. Turn on privacy mode and verify values are masked in visible, accessible, printed, and CSV report content. Go offline and back online and hear both announcements. Record the results in the release notes.

## 8. Exceptions

| Criterion | Exception | Equivalent / reason |
| --- | --- | --- |
| 1.4.10 Reflow | Grids scroll horizontally at high zoom. | Two-dimensional data is exempt. |
| 1.4.3 Contrast | none | All palettes pass (`05` §1.10). |
