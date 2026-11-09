# 17 — Dialogs, Popovers (Callouts), Tooltips & Overlays

Three families of transient UI, plus toasts (§9). Each is implemented once as a reusable Vue component plus a composable service, and used everywhere.

## 1. TaskDialog (modal message / decision)

Every component in this chapter follows its ARIA pattern and focus rules in `22` §3–4.

Modelled on the Windows task dialog.

```text
┌──────────────────────────────────────────────────────────┐
│ Title (optional; header --bar-h, none w/o title) ✕*      │
├──────────────────────────────────────────────────────────┤
│ [icon]  Main instruction (700 xl, --accent-green)        │
│         Content (md, --text; limited HTML: **, *,        │
│         <br>, <a data-event="…">)                        │
│                                                          │
│         ➜ Command link title (700 xl --text-subtle;      │
│           default one --accent-blue)                     │
│             sub-label (italic body --text-subtle)        │
│         ➜ Another command link                           │
├──────────────────────────────────────────────────────────┤
│ [ ] Checkbox text (body --text)      [Cancel] [OK]       │
└──────────────────────────────────────────────────────────┘
```

API (`useDialogs()`):

```ts
showTaskDialog(opts: {
  instruction: string; content?: string; title?: string; footer?: string;
  icon?: 'none' | 'info' | 'warning' | 'error' | 'help' | 'logo';
  buttons: Array<'ok'|'cancel'|'close'|'yes'|'no'|'retry' | { id: string; label: string; isDefault?: boolean }>;
  commandLinks?: Array<{ id: string; title: string; subLabel?: string; isDefault?: boolean }>;
  checkbox?: { text: string; checked?: boolean; tooltip?: string };
  cancelable?: boolean;               // shows ✕ and allows Esc even without a cancel-type button
}): Promise<{ button: string | null; checkboxChecked: boolean }>
```

- The text column is `--dialog-text-w` wide. Content padding is `--space-6` top/bottom and `--space-5` left/right. Centered modal with a dimmed backdrop, glow and shadow.
- Content HTML is sanitized (allowlist `b, i, br, p, a[data-event]`). `\r\n`, `\r` and `\n` become `<br/>`. Links with `data-event` resolve the promise with `{button: 'link:' + event}` or call an `onLink` callback. `http(s)` links open externally.
- Standard button labels: "Ok", "Cancel", "Close", "Yes", "No", "Retry".
- **Default button:** the one flagged `isDefault`, otherwise the last footer button that isn't Cancel/No. Focus goes to the default button (or the first command link). Enter = default.
- Esc closes with `button: null` only if there's a Cancel, Close or No button (or `cancelable`).
- Icons: error → error icon; info/help/warning/logo → the app logo (as the original did) or the matching Lucide icon; none → no icon.
- While any modal is open, keyboard shortcuts and register commit/cancel requests are suppressed (`06` §6).
- Dialogs stack (a LIFO stack in `DialogHost`).

### 1.1 PromptDialog helper

`showCategoryNameError(message)` = a TaskDialog with instruction "Please choose a different category name", the message as content, **Close** and the logo icon. Only one at a time.

## 2. Standard dialogs

Modal, centered windows inside the app window (not native windows): a light gradient header (`--bar-h`) with a title and a ✕, white content, and a footer button row (`--bar-h-lg`; Cancel left of the default primary button). Esc → cancel. Enter → default button, unless focus is in a multi-line text area.

Used by: Create Account (`13` §2), Close Account (`13` §4), Reconciliation Statement (`13` §6.1), Payee Settings (`14` §4), the Schedule dialog (`12` §3.1), Rename Payee (`14` §3.1), Add New Category (`11` §4.2), Import Transactions/Import Account (`16` §1), Wipe the Slate Clean (`18` §2), About (`18` §1), Keyboard Shortcuts (`06` §6.1), Notifications (`24` §4.6), Sign-in and Encryption password (`03` §6–7).

Component: `<StandardDialog title width height @cancel @submit>` with slots for content and footer.

## 3. Callouts (popovers with a tail)

Non-modal panels anchored to an element. Component `<Callout>`, service `useCallouts().open(component, props, opts)`.

| Option | Values |
| --- | --- |
| `variant` | `gradient` (`--callout-bg-start` → `--callout-bg-end`), `opaque` (`--panel-bg`), `help` (`--callout-help-bg`, border `--callout-help-border`) |
| `tail` | about 3 × 1.4 rem, offset `--space-2`, `--space-4` from the edge |
| `placements` | ordered preference list of the 12 tail positions: `top, topLeft, topRight, bottom, bottomLeft, bottomRight, left, leftTop, leftBottom, right, rightTop, rightBottom`. The first that fits the viewport wins (Floating UI `flip` with a custom fallback order). Default: `bottom, top, left, right, bottomLeft, bottomRight, topLeft, topRight, leftTop, leftBottom, rightTop, rightBottom`. **A tail name is the edge of the callout that carries the tail, so `top*` means the callout opens *below* its anchor, `bottom*` *above*, `left*` to the *right* of it and `right*` to the *left*** (the tail always points at the anchor). Every `placements` list in the app follows this reading (see "Placement rules" below). |
| `closeOnRollOut` | default **false** in this app (the original's callouts in scope set it false). If true, it closes 350 ms after the pointer leaves both the anchor and the callout. |
| `closeOnClickOutside` | default true. Result `'clickOutside'`, which note editors treat as save. A click in the calculator of a field inside the callout isn't outside (`09` §5.4). |
| `closeOnEsc` | default true |
| `width` | default `--popover-w` |

Layout: a title bar sized to its text (400 `xl` `--text-subtle`), body, and a button row with Cancel (standard button) and Done (primary, check icon). `open()` returns a promise with the result id.

**Placement rules.** A callout is never clipped by the window. A callout whose button sits near the top of the window could otherwise be cut off when its `placements` list prefers only the side with less room, without a fallback that fits.

1. **Naming.** Callers that want a callout below the anchor (drop-down style: filters, Timeframe, column chooser, menus) pass `top*` tails: `['topLeft', 'top', 'topRight', 'bottomLeft', 'bottom', 'bottomRight']` (below first, above only as a fallback). Left-aligned anchors prefer `topLeft`; right-aligned ones (toolbar items near the right edge) prefer `topRight`. Callers that want it above pass `bottom*` tails. Never list only tails from one side for an anchor that can sit near the matching window edge.
2. **Middleware order** (Floating UI, `strategy: 'fixed'`): `offset`, `flip({ fallbackPlacements, fallbackStrategy: 'bestFit' })`, `shift({ padding })`, `size()`, `arrow`. `bestFit` makes `flip` pick the side with the most room when no listed placement fits, instead of keeping the first one. `shift` stays on its main axis (no `crossAxis`): at 200% zoom a cross-axis shift would slide the panel up over its button, and `size` would then offer the whole window height (Floating UI's `size` reads `shift`'s enabled axes) instead of the room on the chosen side. `size` keeps the panel inside the window on that axis instead.
3. **Size to the space available.** `size({ padding })` sets the panel's `max-height` and `max-width` to the room left in the viewport on the chosen side (`availableHeight`, `availableWidth`), minus the `shift` padding (`--space-2`). The title bar and button row stay visible, and the body between them scrolls (`overflow-y: auto`; `min-height: 0` on the flex body). This replaces the fixed `90vh` caps. The panel is always fully inside the viewport, to within `--space-2` of each edge, at any zoom (`22` §5) and any window size above the minimum (`05` §3.6).
4. **The tail keeps pointing at the anchor** after `shift` or `size` (the `arrow` middleware runs last and is clamped to the panel's corners). If the anchor is scrolled out of view, `autoUpdate` keeps the callout glued to it, as today.
5. **Audit.** Every `placements` list in `src/renderer` and in this spec is re-checked against rule 1. The known callers are the register Timeframe callout (`10` §3) and the budget popovers (`09` §6), which include the note popover the account header opens (`13` §3). Their documented preferences already use the tail-edge reading (for example "topLeft, bottomLeft, top, bottom" starts below the anchor), so the code must match the spec.

Callouts in the app:

| Callout | Spec |
| --- | --- |
| Edit/Add category, Edit/Add master category | `09` §6.1–6.2 |
| Note editor | `09` §6.3 |
| Overspending Settings | `09` §6.4 |
| Show Hidden Categories | `09` §6.5 |
| Transactions list | `09` §6.6 |
| Budget cell Quick Budget list & Calculator | `09` §5.4 |
| Hold for next month | `09` §5.5 |
| Account note (the note popover, opened from the register's account header) | `13` §3, `09` §6.3 |
| Needs-category / Approve-reject / Remove-category | `10` §6.3 |
| Timeframe (register) | `10` §3 |
| Income-as-outflow "Just Checking..." | `11` §6 |
| Invalid date | `11` §3 |
| Text callouts (`--popover-w`, optional title, HTML body `body` `--text-subtle`): "How to Enter an Outflow", "Scheduled transaction added", "Transaction moved", "You can't reconcile from the All Accounts view" | various |

## 4. Plain tooltips

- `v-tooltip` directive (custom, not the native `title`): show delay **650 ms** on hover or keyboard focus, stays until the pointer leaves or focus moves; Esc hides it (`22` §4.6). Multi-line text supported. Style: a small `--tooltip-bg` rectangle, 1 px `--tooltip-border` border, `sm` `--text` text.
- Truncated labels (ellipsis) automatically show their full text as a tooltip.
- Disabled-because-offline controls show "Editing is unavailable while offline".

## 5. Help callouts

Help callouts use `--callout-help-bg` and `--callout-help-border`, with an optional title (700 `md` `--text`) and body (`body` `--text`).

## 6. Loading overlay

`useLoadingOverlay().during(label, promise)`: a centered modal box (sized to its label, `--overlay-bg` at 90%, white `2xl` text, no spinner). It appears only if the operation takes more than 150 ms. Labels: "Loading...", "Exporting...", "Importing...", "Syncing...", "Wiping the slate clean".

## 7. Connection banner

Specified in `03` §4 / `06` §2: `--bar-h`, `--banner-bg` with a `--banner-border` bottom border, icon + text + action link (**Retry now**). It's never modal.

## 8. Error dialogs

Unexpected errors: a TaskDialog "Something went wrong" / `{message}` with **Close** and a "Show Logs Folder" link. Errors are logged by the host and main to `{userData}/logs/app.log` (rotating, 5 × 1 MB). How the three processes log, and the debug logging preference (`07` §7), are specified in `02` §8. There's no crash reporting service.

## 9. Toasts

Non-modal messages at the bottom right of the window, used only by the update check and the news feed (`24` §3.3, §4.7). Store `useToasts()` (`show`, `remove`, `close`), component `<ToastHost>`, mounted once in `App.vue` outside the screens. The full behavior is in `24` §5:

- A toast has a stable id (showing it again replaces it), a title, a message, one action button and a ✕ close button. It uses the callout surface (§3) and sits above the screens, below callouts and modal dialogs; the stack is `inert` while a modal is open.
- No toast times out. Closing it (✕ or Esc) runs its `onClose`; the app can also remove one without running it.
- A toast never takes focus: it is announced politely. The stack is the "Messages" region, the last one F6 reaches (`22` §2.1).
