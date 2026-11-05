# 08 — Sidebar (Navigation & Accounts)

The left navigation strip on the blue background: three section buttons (Budget, Reports, All Accounts), three collapsible account groups, the Add Account row, and the bottom row with the privacy toggle, the server web link, the server connection indicator and the collapse toggle.

## 1. Layout

```text
┌───────────────────────────────────┐
│  (space-4)                     │
│ [▣ Budget                    ]│  ← section button, --row-h-lg
│ [▣ Reports                   ]│
│ [▣ All Accounts     $9,999.00]│  ← total of ALL accounts (with symbol)
│  (space-3)                     │
│ ▼ Budget Accounts [3] $5,000.00│ ← group header --row-h (bold italic md); [3] = error badge
│   Checking            2,000.00│ ← account button --row-h
│   Savings             3,500.00│
│   Visa                -500.00 │ ← negative = --negative-on-blue
│ ▼ Off-Budget Accounts $4,999.00│
│   Mortgage        -150,000.00 │
│ ▶ Closed Accounts      $0.00  │ ← collapsed by default
│ [+ Add Account]               │ ← --row-h
│            (flex space)       │
│ (◉) (⊕) (●) Connected    [«]  │ ← privacy, server web link, connection indicator, « collapses sidebar (§2.4)
│  (space-4)                    │
└──────────────────────────────────┘
```

| Property | Value |
| --- | --- |
| Expanded width | buttons `--sidebar-w`, plus `--space-3` left padding and a `--space-1` gap (plus `--scrollbar-w` while the scrollbar shows). The main panel follows the sidebar's width (flex), with no fixed offset. |
| Collapsed width | buttons `--sidebar-w-compact` (same paddings) |
| Heights | section buttons `--row-h-lg`; account buttons and group headers `--row-h` |
| Animation | buttons 200 ms (fade + height); group expand/collapse 100 ms (collapse: fade then shrink; expand: grow then fade); a whole group showing/hiding 250 ms |
| Scrolling | When content is taller than the space, a slim `--scrollbar-w` scrollbar appears. It hides again once the content fits with `--space-4` to spare. Fade masks one `--row-h-lg` tall at the top (when scrolled) and bottom (when more content is below). While the scrollbar shows, the privacy toggle, server web link and connection indicator move into the Add Account row, left of Add Account, and the collapse toggle moves to the right end of that row. |

**Compact (collapsed) mode** labels: "Accounts" (for "All Accounts"), "Budget Accts", "Off-Budget Accts", "Closed Accts", "Add" (for "Add Account"). All balances and group badges are hidden. Toggle tooltip: "Click to collapse the sidebar" / "Click to expand the sidebar". The state is saved as `sidebarExpanded` (`19` §1, default expanded). At 150% zoom and above the sidebar is compact automatically; the toggle's tooltip and state follow what is shown, and it can still expand it (`22` §5).

## 2. Buttons

### 2.1 Section buttons (Budget, Reports, All Accounts)

- Icon + label, 600 `lg` white. States: normal, hover (lighter bar), selected (a white "tab" that visually joins the main panel; content shifts `--space-3`).
- **All Accounts** shows the total working balance of **every** account (on, off, closed) with the currency symbol, hidden in compact mode. Its register lists every transaction.

### 2.2 Account buttons

- Name (600 `md` white), truncated with an ellipsis to fit. The balance is right-aligned (600 `body`): white if ≥ 0, `--negative-on-blue` if negative. It is shown without the currency symbol (`<MoneyAmount>`, `06` §7) and is hidden in compact mode.
- Tooltip: "{name} {working balance with symbol}" + "\n\n{note}" when the account has a note.
- **Error badge**, overlapping the left edge of the name, when `attention.count > 0`: a pill (`--badge-h` tall, min width `--badge-h`) with the count. Color by `attention.maxLevel`: `--error-badge`, `--needscat-badge` or `--review-badge` (`05` §1.6). There is a 1 px ring (`--text-on-blue`) around it when the button is selected, which keeps it distinct from the selected row without lightening its color (a lighter variant would fail contrast, `05` §1.10). The decorative badge inside a sidebar row is hidden from assistive technology; the row is named from its content (the visible label, then visually hidden text with the amount in full and the badge's sentence), so the accessible name contains the visible text (`22` §4.3, WCAG 2.5.3). Tooltip: "There is 1 transaction that requires your attention.\nClick on the account for more details" / "There are {n} transactions that require your attention.\nClick on the account for more details".
- Left click → that account's register.
- Right click → a context menu on that account: **Rename Account**, **Edit Account Note**, **Close Account** / **Re-open Account** (`13` §3–4), **Move Up**, **Move Down** (§4; each disabled at its end of the group). Rename Account and Edit Account Note first open that account's register. The same account actions are in the Edit menu for the active account.
- Press and drag (> 11 px movement) → reorder (§4). Disabled when offline.

### 2.3 Group headers

- `--row-h` row (padding left `--space-3` / right `--space-4`): disclosure arrow (▼/▶, `--icon-sm`), title (bold italic `md` white, `--space-3` left padding), `--space-1` gap, a badge summarizing the group (expanded sidebar only, group not empty, count > 0), `--space-3` gap, and the group total right-aligned (bold italic `md`; negative in `--negative-on-blue`; hidden in compact mode).
- Click → toggle. The Budget and Off-Budget group states are saved per budget/device (`onBudgetGroupCollapsed`, `offBudgetGroupCollapsed`, default expanded). Closed is not saved.

| Group | Contains | Total |
| --- | --- | --- |
| **Budget Accounts** | open on-budget accounts | Σ working balances |
| **Off-Budget Accounts** | open off-budget accounts | Σ |
| **Closed Accounts** | closed accounts of either kind | Σ |

- Visibility: Budget Accounts collapses when empty. Off-Budget and Closed are **hidden entirely** when empty. Closed is collapsed unless the selected account is in it.
- When the selected account's group collapses (or the account is deleted, or closed other than by its own **Close Account** in this window), selection moves to the next selectable account. Close Account keeps the account selected: it acts where it is, and the register's ⋯ menu then offers Re-open (`13` §3–4, `22` §3). Search order: open on-budget → Off-Budget group; open off-budget → Budget group; closed on-budget → Budget then Off-Budget; closed off-budget → Off-Budget then Budget. Only expanded groups are searched. The first account with `sortIndex` ≥ the old one wins, else the nearest lower one. If nothing is found → All Accounts.
- Actual **account groups** (`account_group_id`) are not shown. They're preserved untouched (`01` §3).

### 2.4 Bottom controls

- **Add Account** (`--row-h`, sized to its label; icon only in compact mode; regular `md` white, plus icon) → Create Account dialog (`13` §2). Disabled when offline.
- **Privacy mode toggle**: an `--icon` icon button (`--hit-min` hit area) in the row with the connection indicator, left of it (icon only in both modes). It is a toggle button (`aria-pressed`) with an eye icon when privacy mode is off and an eye-with-slash icon when it's on. Tooltip: "Enable privacy mode" when off, "Disable privacy mode" when on. Accessible name: the fixed "Privacy mode" (the state is in `aria-pressed`, `06` §7). Click toggles privacy mode (`06` §7). Always enabled, including offline, because it only changes how values are displayed.
- **Server web link**: an `--icon` globe icon button (`--hit-min` hit area) between the privacy toggle and the connection indicator (icon only in both modes). Click opens the current Actual server's address (`connection.info.serverUrl`) in the OS browser through `shell.openExternal` (`02` §6), where the budget can be used in Actual's own web app. Tooltip and accessible name: "Connect to {url} web". Always enabled, including offline: the browser shows whether the server can be reached. Not shown when there is no server address.
- **Connection indicator** (X6): an `--icon` icon button (`--hit-min` hit area) in the bottom row with a short text label in expanded mode. Driven by the `connection` store (`03` §4):

| State | Icon | Label | Tooltip |
| --- | --- | --- | --- |
| Online | `--status-online` dot/cloud | "Connected" | "Connected to {url}\nLast synced {time}\nClick to sync now" |
| Syncing | animated | "Syncing…" | same |
| OfflineReadOnly / Reconnecting | `--status-offline` cloud with slash | "Offline" | "Can't reach {url}. Showing your budget as of {time}.\nClick to retry" |
| OfflineReadOnly, `signedOut` (`03` §4) | `--status-offline` cloud with a key | "Signed out" | "You're signed out of {url}. Showing your budget as of {time}.\nClick to sign in" |
| unsyncedChanges | `--status-unsynced` | "Not synced" | "Your latest changes haven't reached the server yet.\nClick to retry" |
| AuthRequired / Error | `--status-error` | "Sign-in needed" / "Error" | message + "\nClick for details" |

Each state has its own icon shape, so the indicator never depends on color alone. Icons get a 1 px `--text-on-blue` outline so they stay visible on the blue background in every palette.

Click → Sync Now / Retry / show the details dialog, as appropriate.

- Flexible spacer, then the **collapse/expand** toggle (a `--row-h` square) at the right end of the bottom row, in line with the privacy toggle, server web link and connection indicator.

## 3. Selection & navigation

- Exactly one button is selected (none on the Welcome screen).
- Clicking raises a navigation (`06` §3). Clicks are ignored while the currently shown screen is still loading.
- Selecting an account inside a collapsed group expands that group.
- The sidebar re-sorts when an account's order or closed state changes.

## 4. Drag-and-drop reordering

Use pointer events, not HTML5 DnD, for an exact 11 px threshold. Every drag here has a keyboard and menu equivalent (`22` §2.4).

- Start: pointer down on an account button (not All Accounts), then a move > 11 px on either axis. Only when `canEdit`.
- On start: the drag proxy is a semi-transparent clone of the button. The original's slot becomes an empty **drop hint** (`--row-h`, insertion-arrow icon). An account can only move **within its own group** (Budget, Off-Budget or Closed): its on/off-budget and closed state change only through the account's own actions (`13`), not by dragging, as in Actual.
- While dragging over an account button of the same group (its bounds inset 5 px top and bottom), the hint moves to that position. Over the group's header, the hint goes to index 0. Anywhere else, the hint is hidden.
- Auto-scroll when the pointer is within 25 px of the top or bottom of the scroll area (speed grows with distance).
- Drop: with the hint shown, `accounts.reorder(id, beforeId, group)` writes the moved account's `sort_order` as the midpoint of its new neighbors, with the public `updateAccount` (`04` §3). Each sidebar group is ordered independently by `sort_order`. A selected account stays selected. Dropping anywhere without the hint (another group, outside) cancels and changes nothing.

## 5. View model

```ts
interface SidebarVm {
  allAccountsBalance: Money; onBudgetTotal: Money; offBudgetTotal: Money; closedTotal: Money;
  accounts: Array<Pick<Account,'id'|'name'|'note'|'onBudget'|'closed'|'sortIndex'|'attention'>
                  & { workingBalance: Money }>;
  expanded: boolean;
}
```

Built from the `accounts.list` query (Vue Query key `['accounts']`), refreshed on `data:changed`.
