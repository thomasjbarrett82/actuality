# 05 — Visual Design System

The target is **a layout and color semantics inspired by YNAB 4, with a modernized look**. The Light palette, the type scale and the size scale below started from measurements of that design; seventeen Light colors were adjusted to meet contrast targets (§1.10). The app also has a Dark palette and color-blind safe versions of both (§1.9). They keep the original color meanings, and the CVD palettes move the meanings that rely on red vs green onto blue vs orange. Gradients and bevels may be flattened. Keep the colors' meaning and the density, proportions and hierarchy, because users' muscle memory depends on them; exact pixel sizes are not required (§3).

No third-party images, icons or fonts ship with the app. Images are recreated as CSS gradients or icons (§5).

Implementation: `src/renderer/styles/tokens.css` defines every token below as a CSS custom property. Components use only tokens, never raw hex values. A stylelint rule fails the build on a hex color anywhere else in `src/renderer`, and SVG icons use `currentColor` or a token. Vue SFCs use `<style scoped>`.

## 1. Color tokens

Every token has four values, one per **palette** (§1.9): **Light** (the inspiration colors), **Dark**, **Light CVD** and **Dark CVD**. CVD stands for color vision deficiency: these are the color-blind safe palettes. In the tables, `=` in a CVD column means "same as the base theme" (Light or Dark). Tokens marked (new) stand for a hex value or a color word that a feature chapter would otherwise spell out.

### 1.1 Brand & chrome

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--app-bg` | `#22779B` | `#17435A` | = | = | Window/sidebar background (blue), start screens ("blue canvas") |
| `--app-bg-dark` | `#00365F` | `#0A2233` | = | = | Translucent overlays on blue: budget-list buttons at 30% / 40% hover / 50% pressed alpha, `--radius-sm` |
| `--panel-bg` | `#FFFFFF` | `#1E2327` | = | = | Main content panel |
| `--text-on-blue` | `#FFFFFF` | `#F2F5F7` | = | = | Sidebar labels |
| `--negative-on-blue` | `#FFF5F5` | `#FFB4B5` | `#FFF6EB` | `#FFC98F` | Negative balances in the sidebar |
| `--status-online` | `#5BAE3A` | `#6CC24A` | `#56B4E9` | `#56B4E9` | Sidebar connection indicator: Connected / Syncing (`08` §2.4) (new) |
| `--status-error` | `#E5413B` | `#FF6B5E` | `#D55E00` | `#E8743A` | Sidebar connection indicator: Sign-in needed / Error (new) |
| `--status-unsynced` | `#F2C14E` | `#F2C14E` | `#F0E442` | `#F0E442` | Sidebar connection indicator: Not synced (new) |
| `--status-offline` | `#B6BFC4` | `#8A949B` | = | = | Sidebar connection indicator: Offline / Signed out (new) |
| `--focus-ring` | `#0082CB` | `#4FB3F0` | = | = | 2 px focus outline (`22` §3) (new). On `--app-bg` (sidebar, blue canvas) the outline uses `--text-on-blue` instead, because this blue doesn't show on blue. |
| `--logo-peak` | `#00365F` | `#E3E6E8` | = | = | App logo (`AppLogo.vue`, §5): the upper triangle (new) |
| `--logo-base` | `#508200` | `#8CCB3A` | = | = | App logo: the base bar (new) |
| `--logo-on-blue-base` | `#FFFFFF` | `#B5D96A` | = | = | Logo base bar on `--app-bg` (the start-screen wordmark; its upper triangle and lettering are `--text-on-blue`) (new) |
| `--logo-tile-base` | `#8CCB3A` | `#8CCB3A` | = | = | `AppSpinner.vue`: the rising fill, on an `--app-bg-dark` tile with a `--text-on-blue` triangle (new) |

### 1.2 Text

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--text` | `#333333` | `#E3E6E8` | = | = | Default body text; tooltip, callout and checkbox text |
| `--text-grid` | `#2F302F` | `#DADDDF` | = | = | Register rows |
| `--text-strong` | `#4B4C4B` | `#D0D4D7` | = | = | Budget column values, register summary amounts, editor buttons, payee name (`09`, `10`, `11`, `14`) (new) |
| `--text-muted` | `#666666` | `#9AA3A9` | = | = | Column titles |
| `--text-subtle` | `#4D4D4D` | `#B8BEC2` | = | = | Popover titles/body, TaskDialog command links and sub-labels |
| `--text-disabled` | `#999999` | `#6B7378` | = | = | Disabled controls, gray placeholders |
| `--text-strike` | `#6A6C6A` | `#ACB2B5` | = | = | Rows shown only for context in search (struck through) |
| `--text-danger` | `#D14238` | `#FF7A6E` | = | = | Red error text in the sign-in and encryption dialogs (new) |
| `--link` | `#0912C7` | `#8AB4FF` | = | = | Links in popovers |
| `--link-danger` | `#B60000` | `#FF8A80` | = | = | Delete links |
| `--accent-blue` | `#006FAE` | `#4FB3F0` | = | = | Current month in timeline, default TaskDialog command link (was `#0081CA`), Multiple Payees heading (was `#0082D1`) |
| `--accent-green` | `#4F7D00` | `#8CC63F` | = | = | TaskDialog main instruction (was `#6AA800`, §1.10) |

### 1.3 Money semantics

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--money-negative` | `#9C4A49` | `#FF8F8A` | `#A04800` | `#FFA766` | Negative category balance text |
| `--money-negative-pill` | `#F8E4E1` | `#4A2626` | `#FCE5D2` | `#4A3220` | Pill behind negative balances (`--radius`) |
| `--money-negative-strong` | `#D14238` | `#FF6B5E` | `#B84F00` | `#FF9A3D` | Negative summary amounts, including the register summary box (was `#D43D2E`) |
| `--money-positive` | `#508200` | `#8CCB3A` | `#0072B2` | `#5CB8F0` | Positive summary amounts |
| `--atb-positive` | `#AECE5D` | `#B5D96A` | `#7CC4F2` | `#7CC4F2` | "Available to Budget" amount, current month, ≥ 0 |
| `--atb-negative` | `#E9A6A1` | `#F0948D` | `#F5A65B` | `#FFB066` | Negative amount ("Overbudgeted") in the current or the next month |
| `--atb-future` | `#FFFFFF` | `#FFFFFF` | = | = | Future months (except a negative next month) |
| `--atb-past` | `#575757` | `#97A0A7` | = | = | Past months (all header text, on `--header-bg-past`) |
| `--overspend-arrow` | `#D14238` | `#FF6B5E` | `#B84F00` | `#FF9A3D` | Small right-arrow after a negative balance with carryover (`09`) (new) |
| `--change-good` | `#62A000` | `#8CCB3A` | `#0072B2` | `#5CB8F0` | Positive change indicator |

### 1.4 Budget grid

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--budget-cell-border` | `#2DB6E7` | `#3A8DB3` | = | = | Budgeted cell box border & dotted separators |
| `--budget-cell-border-past` | `#B7B8B7` | `#4A5258` | = | = | Past months: cell box border |
| `--budget-dots-past` | `#B0B1B0` | `#464D52` | = | = | Past months: dotted separators (new) |
| `--budget-row-hover` | `#CCD8E0` | `#2E3E4A` | = | = | Row hover and selection highlight across all columns |
| `--budget-master-bg` | `#E6F4FB` | `#22313B` | = | = | Master category (group) row |
| `--budget-master-bg-past` | `#EFF0EF` | `#262A2E` | = | = | Master row, past month |
| `--budget-row-alt-even` | `#EDF6FF` | `#232B32` | = | = | Sub-category rows (even); also split sub-rows |
| `--budget-row-alt-odd` | `#FFFFFF` | `#1E2327` | = | = | Sub-category rows (odd); also split sub-rows |
| `--uncategorized-bg` | `#FFFCDB` | `#38341E` | = | = | Uncategorized Transactions row |
| `--uncategorized-bg-past` | `#EFF0EF` | `#262A2E` | = | = | Uncategorized Transactions row, past month (new) |
| `--uncategorized-text` | `#A05D00` | `#F0B060` | = | = | Uncategorized row text (bold italic) |
| `--hidden-row-text` | `#444444` | `#A0A8AE` | = | = | Hidden Categories row text (`09`) (new) |
| `--drag-indicator` | `#555555` | `#B8C0C5` | = | = | Category / group drop indicator (`09`) (new) |
| `--timeline-no-data-text` | `#9D9D9D` | `#5E676D` | = | = | Timeline months before the first month with data (`09`) (new) |
| `--header-explanation-amount` | `#DCDCDC` | `#DCDCDC` | = | = | Month header math amounts (Semibold 12); the year label |
| `--header-equals-sign` | `#B7B8B7` | `#9EA6AC` | = | = | "=" sign before the Available to Budget amount (new) |
| `--header-explanation-label` | `#B6B7B6` | `#A9B0B5` | = | = | Month header math labels (Regular 12) |
| `--header-bg-current` | `#3A4A52` | `#2E3C44` | = | = | Month header gradient top, current and future months (originals were images) |
| `--header-bg-current-end` | `#26323A` | `#1A242A` | = | = | Month header gradient bottom, current and future months (new) |
| `--header-bg-past` | `#E2E3E2` | `#30363B` | = | = | Month header gradient top, past months |
| `--header-bg-past-end` | `#CFD0CF` | `#272C30` | = | = | Month header gradient bottom, past months (new) |

### 1.5 Register

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--row-alt-even` | `#EDF6FB` | `#232B32` | = | = | Alternating rows (even) |
| `--row-alt-odd` | `#FFFFFF` | `#1E2327` | = | = | Alternating rows (odd) |
| `--row-selected` | `#FAF2AF` | `#4A4320` | = | = | Selected row |
| `--row-edit-border` | `#FD9C3C` | `#E08A30` | = | = | Editor row border |
| `--row-edit-bg` | `#FFF0D4` | `#3D2F1A` | = | = | Editor row background |
| `--grid-line-h` | `#D8D8D8` | `#3A4147` | = | = | Horizontal grid lines |
| `--grid-line-v` | `#E9E9E9` | `#2F353B` | = | = | Vertical grid lines |
| `--register-border` | `#E1E1E1` | `#373E44` | = | = | Borders, split sub-row bottom |
| `--register-gray-bg` | `#EDEDED` | `#2A2F34` | = | = | Gray backgrounds |
| `--split-border` | `#FFD28A` | `#8A6A30` | = | = | Split editor border |
| `--split-text` | `#8E5000` | `#F0B060` | = | = | Sub-transaction text (bold) |
| `--search-bar-rule` | `#46575E` | `#5A6A72` | = | = | 1 px rules in register panels |
| `--summary-divider` | `#A3A3A3` | `#5C656B` | = | = | Summary box dividers (1 × 38) |
| `--grid-header-bg` | `#3A4A52` | `#2E3C44` | = | = | Register grid header: same gradient as the month header (`--header-bg-current` → `--header-bg-current-end`), white bold 14 text |
| `--running-balance-text` | `#6B6B6B` | `#ABB2B6` | = | = | Running balance column |
| `--cleared-on` | `#56A537` | `#6CC24A` | `#0072B2` | `#56B4E9` | Cleared "C", filled glyph (new; was "green C") |
| `--cleared-off` | `#B0B0B0` | `#5E676D` | = | = | Uncleared "C", outline glyph (new; was "gray C") |

### 1.6 Error levels

Error levels are never shown by color alone: each has its icon, and pills carry text.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--error-row-bg` | `#FFECEC` | `#3A2224` | `#FDEBE1` | `#3A2618` | error: row background |
| `--error-row-border` | `#EA9797` | `#8A4A4A` | `#A84A1A` | `#D0703A` | error: row border |
| `--error-pill-bg` | `#F2C7C4` | `#5C2A2A` | `#F6CDB8` | `#5E3216` | error: pill |
| `--error-pill-text` | `#A72522` | `#FF9C94` | `#9A3300` | `#FFA066` | error: pill text |
| `--error-badge` | `#D14238` | `#DA372A` | `#B8400A` | `#C05422` | error: badge (white text) |
| `--review-row-bg` | `#F5F7FF` | `#22283A` | = | = | forReview: row background |
| `--review-row-border` | `#96A6D9` | `#4E5E94` | = | = | forReview: row border |
| `--review-badge` | `#506FD2` | `#4D6EDA` | `#3D63D0` | `#466DE3` | forReview: badge (white text) |
| `--needscat-row-bg` | `#FFF8C7` | `#36321C` | = | = | needsCategory: row background |
| `--needscat-row-border` | `#B5B08F` | `#7A6F3A` | `#E6D46A` | `#5E5520` | needsCategory: row border |
| `--needscat-pill-bg` | `#FFD796` | `#5E4A1E` | `#FBE38A` | `#5A4E12` | needsCategory: pill |
| `--needscat-pill-text` | `#8E5200` | `#F5C06A` | `#6B5600` | `#F5DC6A` | needsCategory: pill text |
| `--needscat-badge` | `#E8A33C` | `#E8A33C` | `#F0C419` | `#F0C419` | needsCategory: badge |
| `--needscat-badge-text` | `#2F302F` | `#2F302F` | = | = | needsCategory: badge text (new) |
| `--badge-text` | `#FFFFFF` | `#FFFFFF` | = | = | error and forReview badge counts: white in every palette (new) |
| `--notifier-error-bg` | `#FFE4E1` | `#3D2420` | `#FDE6DA` | `#3D2A1A` | Error notifier strip |
| `--notifier-error-border` | `#E12C19` | `#E85A48` | `#C24A12` | `#E07A3A` | Error notifier border |

Pills use `--radius-pill`. Badges use white bold text (`--badge-text`), except the needsCategory badge, which uses `--needscat-badge-text`.

### 1.7 Tags

Transaction tag colors come from Actual's synced tag entities (`04` §5.2), not a fixed app palette. Notes show each tag as a text-bearing pill (`#tag-name`) using the entity color. For tags without a color, use the palette's `--tag-default-bg`; choose whichever of black or white gives the stronger text contrast. For a custom entity color, use the same contrast choice. The tag name remains visible and accessible, so color is never the only indication of purpose. User-chosen tag colors do not change with the app palette or CVD setting. When first created, the protected `needs-review` tag entity uses `#96A6D9` (Light `--review-row-border`); existing colors are never reset.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--tag-default-bg` | `#9161C6` | `#A77DDA` | `#CC79A7` | `#D88CB8` | Tag pill when the Actual tag has no color |

### 1.8 Components

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--callout-bg-start` | `#F0F0F0` | `#2C3236` | = | = | `<Callout variant="gradient">` top (`17`) |
| `--callout-bg-end` | `#FFFFFF` | `#252A2E` | = | = | `<Callout variant="gradient">` bottom |
| `--callout-help-bg` | `#FFF7C2` | `#3A3520` | = | = | Help callouts (`17`) |
| `--callout-help-border` | `#E5D27A` | `#7A6C34` | = | = | Help callout border |
| `--tooltip-bg` | `#FFFFE1` | `#2C3236` | = | = | `v-tooltip` background (`17`) |
| `--tooltip-border` | `#767676` | `#5C656B` | = | = | `v-tooltip` 1 px border |
| `--banner-bg` | `#FFF3C4` | `#3A3520` | = | = | ConnectionBanner (`17`) |
| `--banner-border` | `#E0C060` | `#8A7A3A` | = | = | ConnectionBanner bottom border |
| `--overlay-bg` | `#2F3A40` | `#0E1215` | = | = | LoadingOverlay box, at 90% (`17`) |
| `--overlay-shadow` | `#292F33` | `#000000` | = | = | Scrim and overlay shadows |
| `--button-primary-start` | `#528200` | `#4B7B00` | = | = | Primary (green) button gradient top |
| `--button-primary-end` | `#456E00` | `#3F6800` | = | = | Primary (green) button gradient bottom |
| `--button-bg` | `#EDEDED` | `#363D43` | = | = | Standard button background |
| `--button-save-bg` | `#528200` | `#4B7B00` | `#0072B2` | `#0072B2` | Save-tone button: the register editor's Save and add another, Save, Done, Approve and find next and Approve (`11` §2), the Schedule dialog's Save / Add (`12` §3.1). Green, blue in CVD (new) |
| `--button-cancel-bg` | `#D14238` | `#DA372A` | `#B8400A` | `#C05422` | Cancel-tone button: Cancel in the same places, and the needs-review editor's Delete. Red, orange in CVD; aliases `--error-badge` (new) |
| `--button-tone-text` | `#FFFFFF` | `#FFFFFF` | = | = | Label on a save- or cancel-tone button: white in every palette (new) |
| `--news-badge` | `#FFD84D` | `#FFD84D` | = | = | The notifications bell's unread badge, on the blue sidebar (`24` §4.5) (new) |
| `--news-badge-text` | `#2F302F` | `#2F302F` | = | = | The bell badge's count (new) |
| `--news-pill-release-bg` | `#E5F0D3` | `#2D3B1C` | = | = | "Release" type pill on a news entry (`24` §4.6) (new) |
| `--news-pill-release-text` | `#3D6100` | `#B9DE84` | = | = | "Release" pill text (new) |
| `--news-pill-post-bg` | `#DDEBF6` | `#1A3347` | = | = | "Post" type pill on a news entry (new) |
| `--news-pill-post-text` | `#00507E` | `#93CFF2` | = | = | "Post" pill text (new) |

### 1.9 Themes

The palette comes from two per-device preferences (`19` §1), set in Preferences (`07` §7) or View ▸ Appearance (`06` §4):

| Preference | Values | Default |
| --- | --- | --- |
| `appearance` | `system` (follow the OS), `light`, `dark` | `system` |
| `colorVision` | `standard`, `cvd` | `standard` |

- There is one CVD option, tuned for red-green color blindness (protanopia, deuteranopia) and checked against tritanopia. There are no separate protan / deutan / tritan modes.
- `tokens.css` defines Light on `:root`, then overrides it under `:root[data-theme="dark"]`, `:root[data-cvd="on"]` and `:root[data-theme="dark"][data-cvd="on"]`. The renderer sets those attributes on `<html>`.
- With `appearance: system`, the renderer follows `prefers-color-scheme` and switches live when the OS does.
- Main sets `nativeTheme.themeSource` to the `appearance` value, so native menus, dialogs, scrollbars and the title bar match. It creates each `BrowserWindow` with `backgroundColor` set to the palette's `--app-bg` (the first screen is always a blue-canvas one), read from settings before the window exists, so the window never flashes white in dark mode (`06` §1).
- Feature chapters say "white" in two senses. As a background (popovers, dialogs, split sub-rows) it means `--panel-bg`. As text on blue or slate (sidebar, month and grid headers) it means `--text-on-blue`.
- Changing either preference applies immediately to every open window, with no restart.
- **Print and PDF** (`16` §3) always use **Light**, or **Light CVD** when `colorVision` is `cvd`, whatever `appearance` is.
- Windows High Contrast (`forced-colors: active`) isn't a supported palette. The app must stay usable under it: no information is lost when the system replaces colors, and focus stays visible.

### 1.10 Contrast and color-vision rules

Every palette must pass these checks, with no exceptions. `21` §1 makes them a unit test over `tokens.css`.

- **Contrast** (WCAG ratio): ≥ 4.5:1 for text; ≥ 3:1 for large text (WCAG's 18 pt or 14 pt bold, which is ≥ 24 px, or ≥ 18.67 px at weight 700; at 1 rem = 13 px only `--font-2xl` bold qualifies) and for non-text marks that carry meaning (glyphs, meaningful borders, the focus ring).
- **Which pairs:** every foreground token is checked against every background a chapter draws it on, including both ends of a gradient. The pairs are listed in `theme-palettes.md` §1, and a feature chapter that puts a token on a new background adds a row there.
- **Color-vision separation**, in the CVD palettes: simulate protanopia, deuteranopia and tritanopia (Machado 2009, severity 1.0), convert to CIE Lab and measure ΔE (CIE76). The minimum is ≥ 15 for each semantic pair: positive vs negative money, `--atb-positive` vs `--atb-negative`, each pair of online / unsynced / error status, cleared vs uncleared, each pair of the three error-level badges, error vs needsCategory row borders, and save- vs cancel-tone buttons. Report positive/negative semantics reuse the money pair; report series are not identified by color alone (`15` §8).
- **No exceptions.** The Light values below, measured from the reference design, miss their contrast target. They're adjusted to pass in Light and Light CVD instead of matching the reference exactly. `--accent-green` is adjusted because the TaskDialog instruction is 18.2 px bold, under the large-text size.

| Token | Reference | Actuality | Contrast (on) |
| --- | --- | --- | --- |
| `--negative-on-blue` | `#FFB4B5` (Light CVD `#FFC98F`) | `#FFF5F5` (Light CVD `#FFF6EB`) | 4.70:1 (`--app-bg`) |
| `--atb-negative` | `#E38E88` | `#E9A6A1` | 4.57:1 (`--header-bg-current`) |
| `--needscat-pill-text` | `#A05D00` | `#8E5200` | 4.59:1 (`--needscat-pill-bg`) |
| `--needscat-badge-text` | `#FFFFFF` | `#2F302F` | 6.14:1 (`--needscat-badge`) |
| `--cleared-on` | `#5BAE3A` | `#56A537` | 3.07:1 (`--panel-bg`) |
| `--app-bg` | `#2C98C6` | `#22779B` | 5.02:1 under `--text-on-blue` |
| `--accent-blue` | `#0082CB` | `#006FAE` | 4.62:1 (`--button-bg`) |
| `--money-positive` | `#62A000` | `#508200` | 4.63:1 (`--panel-bg`) |
| `--atb-past` | `#D0D0D0` | `#575757` | 4.67:1 (`--header-bg-past-end`) |
| `--header-equals-sign` | `#808180` | `#B7B8B7` | 4.63:1 (`--header-bg-current`) |
| `--running-balance-text` | `#A5A5A5` | `#6B6B6B` | 4.67:1 (`--row-selected`) |
| `--text-strike` | `#8B8D8B` | `#6A6C6A` | 4.64:1 (`--row-selected`) |
| `--button-primary-start` | `#6AA800` | `#528200` | 4.61:1 under `--text-on-blue` (primary button label) |
| `--button-primary-end` | `#5A9200` | `#456E00` | 6.03:1 under `--text-on-blue` |
| `--review-badge` | `#5E7BD6` | `#506FD2` | 4.62:1 under `--badge-text` |
| `--accent-green` | `#6AA800` | `#4F7D00` | 4.92:1 (`--panel-bg`) |

Dark was adjusted the same way for `--error-badge` (`#DA372A`; Dark CVD `#C05422`), `--review-badge` (`#4D6EDA`; Dark CVD `#466DE3`), `--button-primary-start` (`#4B7B00`), `--button-primary-end` (`#3F6800`), `--atb-past` (`#97A0A7`), `--header-equals-sign` (`#9EA6AC`), `--running-balance-text` (`#ABB2B6`) and `--text-strike` (`#ACB2B5`). `--focus-ring` and `--change-good` keep their values: they are non-text marks and pass 3:1.

### 1.11 Reports and chart tokens

Reports use the values below for Light, Dark, Light CVD, and Dark CVD. Tokens whose Use names
another token alias that existing palette value; other tokens are defined as report-specific
variables. Contrast results are in `theme-palettes.md` §1. The required tokens are:

- `--report-inflow`, `--report-outflow`, `--report-positive`, and `--report-negative` for flow and
  change semantics;
- `--report-series-1` through `--report-series-6` for categorical series, plus
  `--report-series-other` for aggregated rows;
- `--report-grid`, `--report-zero-line`, and `--report-tooltip-bg` for chart structure and
  tooltips.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--report-inflow` | `#508200` | `#8CCB3A` | `#0072B2` | `#5CB8F0` | Inflow; aliases `--money-positive` |
| `--report-outflow` | `#D14238` | `#FF6B5E` | `#B84F00` | `#FF9A3D` | Outflow; aliases `--money-negative-strong` |
| `--report-positive` | `#508200` | `#8CCB3A` | `#0072B2` | `#5CB8F0` | Positive change; aliases `--money-positive` |
| `--report-negative` | `#D14238` | `#FF6B5E` | `#B84F00` | `#FF9A3D` | Negative change; aliases `--money-negative-strong` |
| `--report-series-1` | `#006FAE` | `#4FB3F0` | `#006FAE` | `#4FB3F0` | Categorical series; aliases `--accent-blue` |
| `--report-series-2` | `#508200` | `#8CCB3A` | `#0072B2` | `#5CB8F0` | Categorical series; aliases `--money-positive` |
| `--report-series-3` | `#D14238` | `#FF6B5E` | `#B84F00` | `#FF9A3D` | Categorical series; aliases `--money-negative-strong` |
| `--report-series-4` | `#506FD2` | `#4D6EDA` | `#3D63D0` | `#466DE3` | Categorical series; aliases `--review-badge` |
| `--report-series-5` | `#A05D00` | `#F0B060` | `#A05D00` | `#F0B060` | Categorical series; aliases `--uncategorized-text` |
| `--report-series-6` | `#9161C6` | `#A77DDA` | `#CC79A7` | `#D88CB8` | Categorical series; aliases `--tag-default-bg` |
| `--report-series-other` | `#666666` | `#9AA3A9` | `#666666` | `#9AA3A9` | Aggregated rows; aliases `--text-muted` |
| `--report-grid` | `#D8D8D8` | `#3A4147` | `#D8D8D8` | `#3A4147` | Decorative chart grid; aliases `--grid-line-h` |
| `--report-zero-line` | `#666666` | `#9AA3A9` | `#666666` | `#9AA3A9` | Meaningful chart baseline; aliases `--text-muted` |
| `--report-tooltip-bg` | `#FFFFE1` | `#2C3236` | `#FFFFE1` | `#2C3236` | Chart tooltips; aliases `--tooltip-bg` |

Series must also use stable labels and non-color cues (line pattern, marker, or table swatch);
pairwise series-color separation is not relied on to communicate identity. Positive and negative
report semantics inherit the measured color-vision separation of `--money-positive` and
`--money-negative-strong` (`theme-palettes.md` §1). No age-band colors are specified; Money Age
status must be communicated with text and values, not an unverified color threshold. Reports must
not use raw color literals.

## 2. Typography

**Source Sans 3** (bundled, weights 400/600/700 + italics), fallback `system-ui, sans-serif`.

**Root size.** `html { font-size: 81.25% }`, so **1 rem = 13 px** at Chromium's default 16 px and 100% zoom. All text sizes, spacing and component sizes are in `rem` (§3), so they follow the user's zoom (`22` §5) and default font size together. The px values in the tables are what each token measures at that default, for reference.

**Type scale** (tokens in `tokens.css`):

| Token | rem | ≈ px | Used for |
| --- | --- | --- | --- |
| `--font-xs` | 0.85 | 11 | small captions |
| `--font-sm` | 0.925 | 12 | default labels and inputs, header math, year label, links in popovers |
| `--font-body` | 1 | 13 | body text, grids, help callouts, sidebar balances |
| `--font-md` | 1.075 | 14 | buttons, sidebar accounts and group headers, grid headers, "Categories" |
| `--font-lg` | 1.25 | 16 | sidebar section buttons, scheduler title |
| `--font-xl` | 1.4 | 18 | popover titles, TaskDialog instruction and command links, month name, payee name in Payee Settings |
| `--font-2xl` | 1.85 | 24 | Available to Budget amount, loading overlay text |

**Notation.** Feature chapters write a text style as *weight step*, e.g. "600 `md`" = `font-weight: 600; font-size: var(--font-md)`. A step name alone ("`sm` text") keeps the default weight 400. The reference design used a few more sizes (19 px month name, 20 px payee name); they're folded into the nearest step.

The reference design used 1 px text shadows (white below on light backgrounds, black below on blue/dark). They're optional: keep a subtle `0 1px 0 rgba(0,0,0,.35)` on blue/dark backgrounds for legibility, and drop the rest. Dark palettes use no text shadows.

## 3. Sizes

**Principle.** Keep the reference **density, proportions and hierarchy**, not its exact pixel measurements. Every size is a token on the scales below, written in `rem` so it follows zoom and font size. Feature chapters name tokens; where they give a one-off size, it's in `rem` (1 rem ≈ 13 px). Containers size to their content between a minimum and a maximum wherever possible, so longer translations (`20` §3.6) and larger text grow the layout instead of being cut off.

### 3.1 Spacing

| Token | rem | ≈ px | Typical use |
| --- | --- | --- | --- |
| `--space-1` | 0.15 | 2 | hairline gaps, badge offsets |
| `--space-2` | 0.3 | 4 | gaps inside controls, between small buttons |
| `--space-3` | 0.5 | 6.5 | toolbar gaps, panel padding, month column gap |
| `--space-4` | 0.75 | 10 | group indents, section gaps |
| `--space-5` | 1 | 13 | category indent, dialog side padding |
| `--space-6` | 1.5 | 20 | dialog top/bottom padding, callout offsets |
| `--space-7` | 2 | 26 | large section separation |

### 3.2 Heights

| Token | rem | ≈ px | Used for |
| --- | --- | --- | --- |
| `--row-h` | 1.85 | 24 | budget, register, scheduler and popover grid rows; clickable list rows (Quick Budget list, search drop-down, auto-complete lists); sidebar account and group rows; import preview rows. Budget rows are 24 px (the reference design's are 22 px) so in-row targets meet `22` §5. |
| `--row-h-lg` | 2.85 | 37 | sidebar section buttons |
| `--control-h-sm` | 1.85 | 24 | small buttons (editor buttons, filter buttons, Export/Print), was 20 px |
| `--control-h` | 2.15 | 28 | toolbar buttons, segmented controls, search box, search info bar |
| `--control-h-lg` | 4.25 | 55 | chunky buttons (Reconcile Account, Scheduled Transactions) |
| `--bar-h` | 2.5 | 32.5 | connection banner, scheduler title bar |
| `--bar-h-lg` | 3.25 | 42 | standard dialog button row (`17` §2) |
| `--badge-h` | 1.75 | 23 | error badges (min width = height) |
| `--badge-h-sm` | 1.1 | 14 | the notifications bell's unread badge (min width = height), which sits on a `--hit-min` icon button (`24` §4.5) |

Rows and controls set a `min-height` from these tokens and grow if their content needs more (larger text, two-line labels). Clickable rows and controls use `min-height: max(var(--token), var(--hit-min))`, so they never drop below the minimum target size even if the root font size is smaller than the default. **Icon buttons** (note, Quick Budget, close ✕, connection indicator) draw an `--icon` glyph centered in a hit area of at least `--hit-min` × `--hit-min`. Grids that are virtualized use the computed value of `--row-h` (§3.5).

### 3.3 Widths

| Token | rem | ≈ px | Used for |
| --- | --- | --- | --- |
| `--sidebar-w` / `--sidebar-w-compact` | 19 / 10 | 247 / 130 | sidebar buttons, expanded / compact (`08`) |
| `--category-col-w` | 14.5, resizable 14.5–29 | 188, 188–377 | budget category column (`09`) |
| `--month-col-w` | 19 (minimum) | 247 | budget month column; extra width is shared between the visible months |
| `--popover-w-xs` | 12.5 | 162 | compact popovers |
| `--popover-w-sm` | 23 | 299 | small callouts (Hold for next month, Show Hidden Categories) |
| `--popover-w` | 29 | 377 | standard callouts (category edit, Overspending Settings, text callouts) |
| `--popover-w-lg` | 36 | 468 | Transactions popover |
| `--dialog-w-sm` | 28 | 364 | Reconciliation Statement, small standard dialogs |
| `--dialog-w` | 37 | 481 | Create Account, Rename Payee |
| `--dialog-w-lg` | 46 | 598 | Wipe the Slate Clean, import account mapping |
| `--dialog-w-xl` | 55 | 715 | Payee Settings |
| `--dialog-text-w` | 32.5 | 423 | TaskDialog text column |
| `--canvas-col-w` | 54 | 702 | the centered column on blue-canvas screens (`07`); `max-width: 100%` minus `--space-6` each side |
| `--scheduler-h` | 15.5 (default), 14.25 (min) | 201 / 185 | scheduler pane height (`10`) |

Popovers and dialogs use their token as the **preferred** width, with `max-width: calc(100vw - 2 * var(--space-6))`. Their height comes from their content, up to 90% of the window, and the body scrolls beyond that. Widths are never set in px.

### 3.4 Radii, icons and other tokens

| Token | Value | Used for |
| --- | --- | --- |
| `--radius-sm` / `--radius` / `--radius-pill` | 0.3 rem / 0.6 rem / 999px | buttons and every register toolbar control / balance pills / error pills, badges, segmented controls outside the register toolbar |
| `--icon-sm` / `--icon` / `--icon-lg` | 1 / 1.25 / 1.85 rem | inline glyphs (cleared, note) / toolbar and sidebar icons / dialog icons |
| `--scrollbar-w` | 0.9 rem | thin custom scrollbars |
| `--hit-min` | 24px | minimum target size (`22` §5); a px value because WCAG defines it in CSS px |

### 3.5 Where px stays

`px` is allowed only for: 1 px borders and hairlines, the 2 px focus ring and drop indicators, `--radius-pill`, `--hit-min`, text-shadow offsets, pointer thresholds and zones measured in JavaScript (the 11 px drag threshold, drop-target insets, auto-scroll zones), and the window's own size (§3.6). A stylelint rule (`21` §1) rejects `px` anywhere else in `src/renderer`.

Virtualized grids (register, scheduler) need a row height in px. They read the computed value of `--row-h` at mount, and again when the zoom factor or root font size changes, and re-measure. Saved user sizes (column widths, `categoryColumnWidth`, the scheduler height) are stored in **rem**, so they keep their proportions when zoom or font size changes.

### 3.6 Window

| Item | Value |
| --- | --- |
| Window default / minimum | 1020 × 700 / 800 × 560 (device-independent px; `06` §1) |
| Tooltip show delay | 650 ms. Callouts that close on roll-out close 350 ms after the pointer leaves. |
| Animations | sidebar buttons 200 ms; group collapse 100 ms; header collapse 200 ms; screen slide 350 ms; search box grow 300 ms; scheduler expand 300 ms; reconcile transition 500 ms; timeline indicator 250 ms ease-out. All disabled when `prefers-reduced-motion`. |

## 4. Component vocabulary

| Component | Look | Vue component |
| --- | --- | --- |
| Standard button | `--button-bg`, 600 `md` `--text`, `--control-h`, `--radius-sm` | `<UiButton>` |
| Primary (green) button | `--button-primary-start`→`--button-primary-end`, white text, check icon | `<UiButton primary>` |
| Toned button | a standard or primary button filled with `--button-save-bg` or `--button-cancel-bg` and a `--button-tone-text` label, so it follows the CVD palettes (green → blue, red → orange); a disabled one goes back to the standard look. Used where a chapter asks for it (`12` §3.1) | `<UiButton tone="save">`, `<UiButton tone="cancel">` |
| Drop-down button | button with ▾ at right | `<UiMenuButton>` |
| Chunky button | `--control-h-lg`, two lines with a `--icon-lg` icon (Reconcile Account, Scheduled Transactions) | `<UiChunkyButton>` |
| Segmented control | `--radius-pill` toggle, `--control-h` (Reports options, Schedule dialog, rule editor) | `<UiSegmented>` |
| Register toolbar controls | `--control-h`, `--radius-sm`, the same rounded rectangle for every control: the buttons (Add has a leading plus icon and Transfer has a leading transfer icon), the reconciled filter's two-segment toggle and the search box (`10` §1, §3) | `<UiButton>`, `<UiMenuButton>`; the toggle and search box are the toolbar's own (`RegisterToolbar`, `SearchBox`) |
| Small etched text button | Rename, Save, Done/Cancel, Approve/Delete in editors; `--control-h-sm`. `tone="save"` fills it with `--button-save-bg` and `tone="cancel"` with `--button-cancel-bg`, both with a `--button-tone-text` label; a disabled toned button goes back to the standard look | `<UiSmallButton>` |
| Link button | underlined `--link` text, optional icon | `<UiLink>` |
| Checkbox / radio | native, accent-colored | native inputs |
| Text field | borderless inside grids; light inset elsewhere | `<UiInput>` |
| Date field | text + calendar drop-down with month/year arrows | `<DateField>` (`11` §3) |
| Month chooser | month/year drop-down | `<MonthPicker>` |
| Callout | bubble with tail, `--callout-bg-start`→`--callout-bg-end` gradient | `<Callout>` (`17` §3) |
| Help callout | `--callout-help-bg` bubble, `--callout-help-border` | `<Callout variant="help">` |
| Notifier pill | colored `--radius-pill` strip with icon, text, link | `<Notifier>` |
| Error badge | `--radius-pill` count badge in the level's `--*-badge` color (§1.6), `--badge-h` tall, min width `--badge-h`, bold `sm` white (`--needscat-badge-text`, dark, for needsCategory) | `<ErrorBadge>` |
| Notifications bell | an `--icon` bell icon button on the blue sidebar with a `--radius-pill` unread badge at its top right: `--badge-h-sm` tall, min width `--badge-h-sm`, bold `xs` `--news-badge-text` on `--news-badge` (`24` §4.5) | `<NotificationsBell>` |
| Toast | the callout surface (`--callout-bg-start`→`--callout-bg-end`, `--tooltip-border`, `--radius`) with a bold `md` title, the message, a standard button and a ✕ close button, about 22 rem wide (`24` §5) | `<ToastHost>` |
| Summary box | inset panel with title + big amount | `<SummaryPanel>` |
| Scrollbars | thin custom, `--scrollbar-w`, the same on every scroll container: transparent track, `--radius-pill` thumb in `--text-muted` (`--text-on-blue` on blue); the system scrollbar under forced colors | global CSS `::-webkit-scrollbar` (`base.css`) |

## 5. Icon & artwork inventory (supply your own)

| Area | Needed |
| --- | --- |
| App | app icon set (16–1024, `.ico`/`.icns`/`.png`), wordmark (light), splash illustrations for Budget / Accounts loading, server and budget icons for the budget list, spinner |
| Sidebar | section icons (budget, reports, accounts), add-account (+), collapse/expand, disclosure ▼/▶, connection states (online, syncing, offline, unsynced, error), privacy mode (eye, eye with a slash), drag-insert arrow |
| Privacy | squiggly-line mask glyph that replaces hidden amounts (`06` §7) |
| Budget | timeline prev/next, note icon (two tones from tokens), Quick Budget, dropdown arrow, overspend right-arrow, expand-all / collapse-all, small plus, calculator, hide, delete |
| Register | edit-transactions, import, reconciled shown/hidden, search, clear ×, clock (scheduled), cleared states (outline C, filled C, lock), error / reminder / needs-category icons, transfer icon, split arrow, approve ✓, eye (show in account view), cancel ×, make-transfer |
| Dialogs | info, help, warning, error, app logo, command-link arrow, close |

Use Lucide icons where they fit. Every icon is a single-color SVG drawn with `currentColor` or a token, so it follows the palette. Icons that need two tones (the note icon, the app logo) take both from tokens instead of shipping light and dark files. Cleared states are small inline SVG components so they can be colored with tokens.

The supplied artwork lives in `resources/` (electron-builder's `buildResources`): `icons/` (the OS icon set: `windows/actuality.ico`, `macos/actuality.icns`, `linux/hicolor/`, plus `png/` and `svg/` masters), `logos/` (wordmark, light and dark) and `spinners/`. Packaging reads the `.ico`, the `.icns` and, for Linux, `png/actuality-icon-512.png` (electron-builder reads an icon folder only as flat `{size}x{size}.png` files, so the `hicolor/` tree is kept for reference). Main sets the window icon on Linux (the 512 px PNG), where the window doesn't take it from the package, and on Windows when unpackaged (the `.ico`; `npm run dev` / `npm run start` run the stock Electron binary, whose own icon would show). In the app, the logo is `AppLogo.vue`: the mark of `icons/svg/actuality-logo-{light,dark}.svg` drawn inline with `--logo-peak` and `--logo-base` (§1.1), used by the WelcomePanel, About, Wipe the Slate Clean and TaskDialog's `logo` icon. `AppWordmark.vue` is `logos/actuality-logo-{light,dark}.svg` the same way (lettering in `currentColor`); the start screens (`07`) show it on the blue canvas with `--text-on-blue` and `--logo-on-blue-base`. `AppSpinner.vue` is `spinners/actuality-spinner-navy-tile.svg` (the tile keeps the rising fill visible on blue in every palette); it is both the Loading screen spinner (`07` §5) and the panel loading illustration (`06` §2), animated with CSS keyframes instead of the file's SMIL so it can follow `prefers-reduced-motion`: there it runs three times slower (7.2 s a cycle), the one exception to `22` §6.
