# Theme Palettes

The four palettes of `05` §1.9, with the checks that every value passes. This file records the reasoning and the check results behind the token values. `05` §1 is normative; if it differs from this file, it wins.

- **Light** is the palette inspired by YNAB 4, with contrast fixes (§10). The most visible is a deeper sidebar blue, ![#22779B](swatches/22779B.svg) `#22779B` instead of the reference ![#2C98C6](swatches/2C98C6.svg) `#2C98C6`, so white sidebar text reaches 4.5:1.
- **Dark** has no counterpart in the reference design. It keeps the blue identity by deepening the sidebar to navy ![#17435A](swatches/17435A.svg) `#17435A`; the content panel is a neutral charcoal ![#1E2327](swatches/1E2327.svg) `#1E2327`.
- **Light CVD** and **Dark CVD** are the color-blind safe versions (CVD = color vision deficiency). They change only colors whose meaning depends on telling red from green: money, status, cleared, error levels and the save / cancel button tones. Those meanings move onto a blue / orange axis (Okabe-Ito).

Each color has a swatch beside it (`swatches/`, generated). In the tables, a **bold** CVD value differs from its base theme (Light or Dark). Tokens marked (new) stand for a hex value or a color word that a feature chapter would otherwise spell out.

## 1. Checks

All four palettes meet every target, with no exceptions. Only the CVD palettes are color-blind safe: in Light and Dark, positive vs negative money and status dots blur together under red-green color blindness. That gap is what the CVD option fixes.

**Contrast** uses the WCAG ratio: 4.5:1 for text; 3:1 for large text (≥ 24 px, or ≥ 18.67 px bold; `05` §1.10) and for non-text marks that carry meaning. Every foreground is checked on every background a chapter draws it on, including both ends of a gradient. A chapter that puts a token on a new background adds a row here.

| Foreground on background | Target | Light | Dark | Light CVD | Dark CVD |
| --- | --- | --- | --- | --- | --- |
| `--text` on `--panel-bg` | 4.5:1 | 12.63 | 12.64 | 12.63 | 12.64 |
| `--text-grid` on `--row-alt-even` | 4.5:1 | 12.10 | 10.52 | 12.10 | 10.52 |
| `--text-grid` on `--row-selected` | 4.5:1 | 11.60 | 7.28 | 11.60 | 7.28 |
| `--text-grid` on `--row-edit-bg` | 4.5:1 | 11.78 | 9.50 | 11.78 | 9.50 |
| `--text-strong` on `--panel-bg` | 4.5:1 | 8.63 | 10.63 | 8.63 | 10.63 |
| `--text-muted` on `--panel-bg` | 4.5:1 | 5.74 | 6.18 | 5.74 | 6.18 |
| `--text-subtle` on `--panel-bg` | 4.5:1 | 8.45 | 8.44 | 8.45 | 8.44 |
| `--text-danger` on `--panel-bg` | 4.5:1 | 4.62 | 6.24 | 4.62 | 6.24 |
| `--link` on `--panel-bg` | 4.5:1 | 10.92 | 7.59 | 10.92 | 7.59 |
| `--link-danger` on `--panel-bg` | 4.5:1 | 7.03 | 6.94 | 7.03 | 6.94 |
| `--accent-blue` on `--panel-bg` | 4.5:1 | 5.41 | 6.82 | 5.41 | 6.82 |
| `--accent-blue` on `--button-bg` | 4.5:1 | 4.62 | 4.74 | 4.62 | 4.74 |
| `--accent-green` on `--panel-bg` | 4.5:1 | 4.92 | 7.75 | 4.92 | 7.75 |
| `--panel-bg` on `--accent-blue` | 4.5:1 | 5.41 | 6.82 | 5.41 | 6.82 |
| `--text-on-blue` on `--grid-header-bg` | 4.5:1 | 9.21 | 10.39 | 9.21 | 10.39 |
| `--text-muted` on `--budget-master-bg` | 4.5:1 | 5.11 | 5.21 | 5.11 | 5.21 |
| `--text-muted` on `--budget-master-bg-past` | 4.5:1 | 5.03 | 5.63 | 5.03 | 5.63 |
| `--text-muted` on `--uncategorized-bg` | 4.5:1 | 5.52 | 4.88 | 5.52 | 4.88 |
| `--text-muted` on `--uncategorized-bg-past` | 4.5:1 | 5.03 | 5.63 | 5.03 | 5.63 |
| `--text-subtle` on `--budget-row-hover` | 4.5:1 | 5.82 | 5.87 | 5.82 | 5.87 |
| `--text-on-blue` on `--app-bg` | 4.5:1 | 5.02 | 9.65 | 5.02 | 9.65 |
| `--negative-on-blue` on `--app-bg` | 4.5:1 | 4.70 | 6.26 | 4.70 | 7.05 |
| `--money-negative` on `--money-negative-pill` | 4.5:1 | 4.92 | 5.98 | 5.05 | 6.20 |
| `--money-negative-strong` on `--panel-bg` | 4.5:1 | 4.62 | 5.67 | 5.05 | 7.50 |
| `--money-positive` on `--panel-bg` | 4.5:1 | 4.63 | 8.09 | 5.19 | 7.22 |
| `--atb-positive` on `--header-bg-current` | 4.5:1 | 5.17 | 7.10 | 4.84 | 5.98 |
| `--atb-negative` on `--header-bg-current` | 4.5:1 | 4.57 | 5.05 | 4.60 | 6.31 |
| `--atb-future` on `--header-bg-current` | 4.5:1 | 9.21 | 11.38 | 9.21 | 11.38 |
| `--header-explanation-label` on `--header-bg-current` | 4.5:1 | 4.58 | 5.18 | 4.58 | 5.18 |
| `--header-equals-sign` on `--header-bg-current` | 4.5:1 | 4.63 | 4.61 | 4.63 | 4.61 |
| `--header-equals-sign` on `--header-bg-current-end` | 4.5:1 | 6.60 | 6.40 | 6.60 | 6.40 |
| `--atb-past` on `--header-bg-past` | 4.5:1 | 5.62 | 4.60 | 5.62 | 4.60 |
| `--atb-past` on `--header-bg-past-end` | 4.5:1 | 4.67 | 5.31 | 4.67 | 5.31 |
| `--running-balance-text` on `--panel-bg` | 4.5:1 | 5.33 | 7.38 | 5.33 | 7.38 |
| `--running-balance-text` on `--row-selected` | 4.5:1 | 4.67 | 4.62 | 4.67 | 4.62 |
| `--text-strike` on `--panel-bg` | 4.5:1 | 5.30 | 7.39 | 5.30 | 7.39 |
| `--text-strike` on `--row-selected` | 4.5:1 | 4.64 | 4.63 | 4.64 | 4.63 |
| `--text-on-blue` on `--button-primary-start` | 4.5:1 | 4.61 | 4.64 | 4.61 | 4.64 |
| `--text-on-blue` on `--button-primary-end` | 4.5:1 | 6.03 | 6.01 | 6.03 | 6.01 |
| `--button-tone-text` on `--button-save-bg` | 4.5:1 | 4.61 | 5.08 | 5.19 | 5.19 |
| `--button-tone-text` on `--button-cancel-bg` | 4.5:1 | 4.62 | 4.60 | 5.56 | 4.63 |
| `--badge-text` on `--error-badge` | 4.5:1 | 4.62 | 4.60 | 5.56 | 4.63 |
| `--badge-text` on `--review-badge` | 4.5:1 | 4.62 | 4.61 | 5.39 | 4.61 |
| `--uncategorized-text` on `--uncategorized-bg` | 4.5:1 | 4.97 | 6.61 | 4.97 | 6.61 |
| `--split-text` on `--panel-bg` | 4.5:1 | 6.37 | 8.37 | 6.37 | 8.37 |
| `--hidden-row-text` on `--panel-bg` | 4.5:1 | 9.74 | 6.57 | 9.74 | 6.57 |
| `--error-pill-text` on `--error-pill-bg` | 4.5:1 | 4.69 | 5.73 | 5.04 | 5.39 |
| `--needscat-pill-text` on `--needscat-pill-bg` | 4.5:1 | 4.59 | 5.10 | 5.57 | 6.05 |
| `--needscat-badge-text` on `--needscat-badge` | 4.5:1 | 6.14 | 6.14 | 7.96 | 7.96 |
| `--news-badge-text` on `--news-badge` | 4.5:1 | 9.58 | 9.58 | 9.58 | 9.58 |
| `--news-pill-release-text` on `--news-pill-release-bg` | 4.5:1 | 6.10 | 7.89 | 6.10 | 7.89 |
| `--news-pill-post-text` on `--news-pill-post-bg` | 4.5:1 | 7.06 | 7.74 | 7.06 | 7.74 |
| `--text` on `--callout-help-bg` | 4.5:1 | 11.63 | 9.80 | 11.63 | 9.80 |
| `--text` on `--tooltip-bg` | 4.5:1 | 12.42 | 10.36 | 12.42 | 10.36 |
| `--text` on `--banner-bg` | 4.5:1 | 11.35 | 9.80 | 11.35 | 9.80 |
| `--cleared-on` on `--panel-bg` | 3:1 | 3.07 | 7.13 | 5.19 | 6.87 |
| `--drag-indicator` on `--panel-bg` | 3:1 | 7.46 | 8.59 | 7.46 | 8.59 |
| `--news-badge` on `--app-bg` | 3:1 | 3.63 | 7.64 | 3.63 | 7.64 |
| `--focus-ring` on `--panel-bg` | 3:1 | 4.15 | 6.82 | 4.15 | 6.82 |
| `--text-on-blue` as the focus ring on `--app-bg` | 3:1 | 5.02 | 9.65 | 5.02 | 9.65 |

**Color-blind separation** is the smallest color difference (CIE76 ΔE in Lab) across simulated protanopia, deuteranopia and tritanopia (Machado 2009, severity 1.0). Targets apply to the CVD palettes: ≥ 15 for semantic pairs. Error and needs-category row tints and pills aren't checked, because they always come with an icon, a badge and pill text.

| Pair that must stay apart | Light | Dark | Light CVD | Dark CVD |
| --- | --- | --- | --- | --- |
| `--money-positive` vs `--money-negative-strong` | 7.9 | 17.7 | 86.5 | 92.0 |
| `--atb-positive` vs `--atb-negative` | 34.3 | 27.1 | 74.8 | 73.4 |
| `--status-online` vs `--status-error` | 5.3 | 5.7 | 88.7 | 78.4 |
| `--status-online` vs `--status-unsynced` | 13.1 | 6.5 | 59.6 | 59.6 |
| `--status-unsynced` vs `--status-error` | 28.9 | 24.9 | 33.6 | 31.0 |
| `--cleared-on` vs `--cleared-off` | 30.8 | 37.3 | 37.2 | 40.2 |
| `--error-badge` vs `--needscat-badge` | 27.6 | 26.1 | 41.3 | 31.9 |
| `--error-badge` vs `--review-badge` | 76.6 | 72.8 | 100.8 | 101.2 |
| `--needscat-badge` vs `--review-badge` | 76.9 | 74.5 | 67.8 | 67.9 |
| `--error-row-border` vs `--needscat-row-border` | 1.8 | 16.7 | 39.5 | 18.6 |
| `--button-save-bg` vs `--button-cancel-bg` | 7.9 | 9.3 | 83.9 | 80.5 |

`21` §1 requires these checks as a unit test over `tokens.css`.

### Reports palette values and checks (`05` §1.11)

The report series and semantic colors alias the existing tokens described in `05` §1.11. The
following measured foreground/background ratios apply to each series mark on `--panel-bg`; the
minimum is 3:1 for a meaningful chart mark. The report grid is decorative and does not encode data.

| Report mark on `--panel-bg` | Target | Light | Dark | Light CVD | Dark CVD |
| --- | --- | --- | --- | --- | --- |
| `--report-inflow` / `--report-positive` | 3:1 | 4.63 | 8.09 | 5.19 | 7.22 |
| `--report-outflow` / `--report-negative` | 3:1 | 4.62 | 5.67 | 5.05 | 7.50 |
| `--report-series-1` | 3:1 | 5.41 | 6.82 | 5.41 | 6.82 |
| `--report-series-2` | 3:1 | 4.63 | 8.09 | 5.19 | 7.22 |
| `--report-series-3` | 3:1 | 4.62 | 5.67 | 5.05 | 7.50 |
| `--report-series-4` | 3:1 | 4.62 | 3.44 | 5.39 | 3.44 |
| `--report-series-5` | 3:1 | 5.17 | 8.37 | 5.17 | 8.37 |
| `--report-series-6` | 3:1 | 4.44 | 4.97 | 3.06 | 6.31 |
| `--report-series-other` / `--report-zero-line` | 3:1 | 5.74 | 6.18 | 5.74 | 6.18 |
| `--text` on `--report-tooltip-bg` | 4.5:1 | 12.42 | 10.36 | 12.42 | 10.36 |

The report positive/negative semantic pair aliases `--money-positive` /
`--money-negative-strong`; its CVD separation is therefore the already measured 86.5 ΔE in Light
CVD and 92.0 ΔE in Dark CVD above. Individual series are not required to meet a pairwise ΔE target:
their identity is also encoded with labels and non-color cues, as required by `05` §1.11. The
decorative grid contrast is intentionally below 3:1 and is not used to distinguish data.

## 2. Brand & chrome

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--app-bg` | ![#22779B](swatches/22779B.svg) `#22779B` | ![#17435A](swatches/17435A.svg) `#17435A` | ![#22779B](swatches/22779B.svg) `#22779B` | ![#17435A](swatches/17435A.svg) `#17435A` | Sidebar, blue canvas (the reference `#2C98C6` deepened for contrast) |
| `--app-bg-dark` | ![#00365F](swatches/00365F.svg) `#00365F` | ![#0A2233](swatches/0A2233.svg) `#0A2233` | ![#00365F](swatches/00365F.svg) `#00365F` | ![#0A2233](swatches/0A2233.svg) `#0A2233` | Overlays on blue (alpha 30/40/50%) |
| `--panel-bg` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#1E2327](swatches/1E2327.svg) `#1E2327` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#1E2327](swatches/1E2327.svg) `#1E2327` | Main content panel |
| `--text-on-blue` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#F2F5F7](swatches/F2F5F7.svg) `#F2F5F7` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#F2F5F7](swatches/F2F5F7.svg) `#F2F5F7` | Sidebar labels |
| `--negative-on-blue` | ![#FFF5F5](swatches/FFF5F5.svg) `#FFF5F5` | ![#FFB4B5](swatches/FFB4B5.svg) `#FFB4B5` | **![#FFF6EB](swatches/FFF6EB.svg) `#FFF6EB`** | **![#FFC98F](swatches/FFC98F.svg) `#FFC98F`** | Negative sidebar balances |
| `--status-online` | ![#5BAE3A](swatches/5BAE3A.svg) `#5BAE3A` | ![#6CC24A](swatches/6CC24A.svg) `#6CC24A` | **![#56B4E9](swatches/56B4E9.svg) `#56B4E9`** | **![#56B4E9](swatches/56B4E9.svg) `#56B4E9`** | Connection indicator: Connected (new) |
| `--status-error` | ![#E5413B](swatches/E5413B.svg) `#E5413B` | ![#FF6B5E](swatches/FF6B5E.svg) `#FF6B5E` | **![#D55E00](swatches/D55E00.svg) `#D55E00`** | **![#E8743A](swatches/E8743A.svg) `#E8743A`** | Connection indicator: Sign-in needed / Error (new) |
| `--status-unsynced` | ![#F2C14E](swatches/F2C14E.svg) `#F2C14E` | ![#F2C14E](swatches/F2C14E.svg) `#F2C14E` | **![#F0E442](swatches/F0E442.svg) `#F0E442`** | **![#F0E442](swatches/F0E442.svg) `#F0E442`** | Connection indicator: Not synced (new) |
| `--status-offline` | ![#B6BFC4](swatches/B6BFC4.svg) `#B6BFC4` | ![#8A949B](swatches/8A949B.svg) `#8A949B` | ![#B6BFC4](swatches/B6BFC4.svg) `#B6BFC4` | ![#8A949B](swatches/8A949B.svg) `#8A949B` | Connection indicator: Offline / Signed out (new) |
| `--focus-ring` | ![#0082CB](swatches/0082CB.svg) `#0082CB` | ![#4FB3F0](swatches/4FB3F0.svg) `#4FB3F0` | ![#0082CB](swatches/0082CB.svg) `#0082CB` | ![#4FB3F0](swatches/4FB3F0.svg) `#4FB3F0` | 2 px focus outline (new; was --accent-blue). On `--app-bg` the outline uses `--text-on-blue`. |
| `--logo-peak` | ![#00365F](swatches/00365F.svg) `#00365F` | ![#E3E6E8](swatches/E3E6E8.svg) `#E3E6E8` | ![#00365F](swatches/00365F.svg) `#00365F` | ![#E3E6E8](swatches/E3E6E8.svg) `#E3E6E8` | App logo: upper triangle (new) |
| `--logo-base` | ![#508200](swatches/508200.svg) `#508200` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | ![#508200](swatches/508200.svg) `#508200` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | App logo: base bar (new) |
| `--logo-on-blue-base` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#B5D96A](swatches/B5D96A.svg) `#B5D96A` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#B5D96A](swatches/B5D96A.svg) `#B5D96A` | Logo base bar on `--app-bg` (start-screen wordmark) (new) |
| `--logo-tile-base` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | Spinner fill on its `--app-bg-dark` tile (new) |

## 3. Text

Text colors don't change in CVD.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--text` | ![#333333](swatches/333333.svg) `#333333` | ![#E3E6E8](swatches/E3E6E8.svg) `#E3E6E8` | ![#333333](swatches/333333.svg) `#333333` | ![#E3E6E8](swatches/E3E6E8.svg) `#E3E6E8` | Body text |
| `--text-grid` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#DADDDF](swatches/DADDDF.svg) `#DADDDF` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#DADDDF](swatches/DADDDF.svg) `#DADDDF` | Register rows |
| `--text-strong` | ![#4B4C4B](swatches/4B4C4B.svg) `#4B4C4B` | ![#D0D4D7](swatches/D0D4D7.svg) `#D0D4D7` | ![#4B4C4B](swatches/4B4C4B.svg) `#4B4C4B` | ![#D0D4D7](swatches/D0D4D7.svg) `#D0D4D7` | Amounts, editor buttons, payee name (new; replaces #4B4C4B / #4C4C4C) |
| `--text-muted` | ![#666666](swatches/666666.svg) `#666666` | ![#9AA3A9](swatches/9AA3A9.svg) `#9AA3A9` | ![#666666](swatches/666666.svg) `#666666` | ![#9AA3A9](swatches/9AA3A9.svg) `#9AA3A9` | Column titles |
| `--text-subtle` | ![#4D4D4D](swatches/4D4D4D.svg) `#4D4D4D` | ![#B8BEC2](swatches/B8BEC2.svg) `#B8BEC2` | ![#4D4D4D](swatches/4D4D4D.svg) `#4D4D4D` | ![#B8BEC2](swatches/B8BEC2.svg) `#B8BEC2` | Popover and TaskDialog text |
| `--text-disabled` | ![#999999](swatches/999999.svg) `#999999` | ![#6B7378](swatches/6B7378.svg) `#6B7378` | ![#999999](swatches/999999.svg) `#999999` | ![#6B7378](swatches/6B7378.svg) `#6B7378` | Disabled controls, placeholders |
| `--text-strike` | ![#6A6C6A](swatches/6A6C6A.svg) `#6A6C6A` | ![#ACB2B5](swatches/ACB2B5.svg) `#ACB2B5` | ![#6A6C6A](swatches/6A6C6A.svg) `#6A6C6A` | ![#ACB2B5](swatches/ACB2B5.svg) `#ACB2B5` | Context-only rows in search |
| `--text-danger` | ![#D14238](swatches/D14238.svg) `#D14238` | ![#FF7A6E](swatches/FF7A6E.svg) `#FF7A6E` | ![#D14238](swatches/D14238.svg) `#D14238` | ![#FF7A6E](swatches/FF7A6E.svg) `#FF7A6E` | Red error text in the sign-in and encryption dialogs (new) |
| `--link` | ![#0912C7](swatches/0912C7.svg) `#0912C7` | ![#8AB4FF](swatches/8AB4FF.svg) `#8AB4FF` | ![#0912C7](swatches/0912C7.svg) `#0912C7` | ![#8AB4FF](swatches/8AB4FF.svg) `#8AB4FF` | Popover links |
| `--link-danger` | ![#B60000](swatches/B60000.svg) `#B60000` | ![#FF8A80](swatches/FF8A80.svg) `#FF8A80` | ![#B60000](swatches/B60000.svg) `#B60000` | ![#FF8A80](swatches/FF8A80.svg) `#FF8A80` | Delete links |
| `--accent-blue` | ![#006FAE](swatches/006FAE.svg) `#006FAE` | ![#4FB3F0](swatches/4FB3F0.svg) `#4FB3F0` | ![#006FAE](swatches/006FAE.svg) `#006FAE` | ![#4FB3F0](swatches/4FB3F0.svg) `#4FB3F0` | Current month, filter buttons, default command link |
| `--accent-green` | ![#4F7D00](swatches/4F7D00.svg) `#4F7D00` | ![#8CC63F](swatches/8CC63F.svg) `#8CC63F` | ![#4F7D00](swatches/4F7D00.svg) `#4F7D00` | ![#8CC63F](swatches/8CC63F.svg) `#8CC63F` | TaskDialog main instruction, primary button |

## 4. Money

In CVD, positive amounts turn blue and negative ones orange.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--money-negative` | ![#9C4A49](swatches/9C4A49.svg) `#9C4A49` | ![#FF8F8A](swatches/FF8F8A.svg) `#FF8F8A` | **![#A04800](swatches/A04800.svg) `#A04800`** | **![#FFA766](swatches/FFA766.svg) `#FFA766`** | Negative category balance text |
| `--money-negative-pill` | ![#F8E4E1](swatches/F8E4E1.svg) `#F8E4E1` | ![#4A2626](swatches/4A2626.svg) `#4A2626` | **![#FCE5D2](swatches/FCE5D2.svg) `#FCE5D2`** | **![#4A3220](swatches/4A3220.svg) `#4A3220`** | Pill behind negative balances |
| `--money-negative-strong` | ![#D14238](swatches/D14238.svg) `#D14238` | ![#FF6B5E](swatches/FF6B5E.svg) `#FF6B5E` | **![#B84F00](swatches/B84F00.svg) `#B84F00`** | **![#FF9A3D](swatches/FF9A3D.svg) `#FF9A3D`** | Negative summary amounts (register summary merged in) |
| `--money-positive` | ![#508200](swatches/508200.svg) `#508200` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | **![#0072B2](swatches/0072B2.svg) `#0072B2`** | **![#5CB8F0](swatches/5CB8F0.svg) `#5CB8F0`** | Positive summary amounts |
| `--atb-positive` | ![#AECE5D](swatches/AECE5D.svg) `#AECE5D` | ![#B5D96A](swatches/B5D96A.svg) `#B5D96A` | **![#7CC4F2](swatches/7CC4F2.svg) `#7CC4F2`** | **![#7CC4F2](swatches/7CC4F2.svg) `#7CC4F2`** | Available to Budget >= 0 (on header) |
| `--atb-negative` | ![#E9A6A1](swatches/E9A6A1.svg) `#E9A6A1` | ![#F0948D](swatches/F0948D.svg) `#F0948D` | **![#F5A65B](swatches/F5A65B.svg) `#F5A65B`** | **![#FFB066](swatches/FFB066.svg) `#FFB066`** | Overbudgeted (on header) |
| `--atb-future` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | Future months (on header) |
| `--atb-past` | ![#575757](swatches/575757.svg) `#575757` | ![#97A0A7](swatches/97A0A7.svg) `#97A0A7` | ![#575757](swatches/575757.svg) `#575757` | ![#97A0A7](swatches/97A0A7.svg) `#97A0A7` | Past months, all header text (on `--header-bg-past`) |
| `--overspend-arrow` | ![#D14238](swatches/D14238.svg) `#D14238` | ![#FF6B5E](swatches/FF6B5E.svg) `#FF6B5E` | **![#B84F00](swatches/B84F00.svg) `#B84F00`** | **![#FF9A3D](swatches/FF9A3D.svg) `#FF9A3D`** | Carryover overspend right-arrow (new) |
| `--change-good` | ![#62A000](swatches/62A000.svg) `#62A000` | ![#8CCB3A](swatches/8CCB3A.svg) `#8CCB3A` | **![#0072B2](swatches/0072B2.svg) `#0072B2`** | **![#5CB8F0](swatches/5CB8F0.svg) `#5CB8F0`** | Positive change indicator |

## 5. Budget grid

The slate month headers are already dark, so Dark only deepens them slightly. Past-month headers move from light gray to dim gray, so past months still read as "behind". In Light, past-month header text is dark gray on the light gray gradient; the reference's pale `#D0D0D0` text was almost invisible there (1.0–1.2:1). CVD makes no changes here.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--budget-cell-border` | ![#2DB6E7](swatches/2DB6E7.svg) `#2DB6E7` | ![#3A8DB3](swatches/3A8DB3.svg) `#3A8DB3` | ![#2DB6E7](swatches/2DB6E7.svg) `#2DB6E7` | ![#3A8DB3](swatches/3A8DB3.svg) `#3A8DB3` | Budgeted cell box, dotted separators |
| `--budget-cell-border-past` | ![#B7B8B7](swatches/B7B8B7.svg) `#B7B8B7` | ![#4A5258](swatches/4A5258.svg) `#4A5258` | ![#B7B8B7](swatches/B7B8B7.svg) `#B7B8B7` | ![#4A5258](swatches/4A5258.svg) `#4A5258` | Past months |
| `--budget-dots-past` | ![#B0B1B0](swatches/B0B1B0.svg) `#B0B1B0` | ![#464D52](swatches/464D52.svg) `#464D52` | ![#B0B1B0](swatches/B0B1B0.svg) `#B0B1B0` | ![#464D52](swatches/464D52.svg) `#464D52` | Past-month dotted separators (new) |
| `--budget-row-hover` | ![#CCD8E0](swatches/CCD8E0.svg) `#CCD8E0` | ![#2E3E4A](swatches/2E3E4A.svg) `#2E3E4A` | ![#CCD8E0](swatches/CCD8E0.svg) `#CCD8E0` | ![#2E3E4A](swatches/2E3E4A.svg) `#2E3E4A` | Row hover / selection |
| `--budget-master-bg` | ![#E6F4FB](swatches/E6F4FB.svg) `#E6F4FB` | ![#22313B](swatches/22313B.svg) `#22313B` | ![#E6F4FB](swatches/E6F4FB.svg) `#E6F4FB` | ![#22313B](swatches/22313B.svg) `#22313B` | Group row |
| `--budget-master-bg-past` | ![#EFF0EF](swatches/EFF0EF.svg) `#EFF0EF` | ![#262A2E](swatches/262A2E.svg) `#262A2E` | ![#EFF0EF](swatches/EFF0EF.svg) `#EFF0EF` | ![#262A2E](swatches/262A2E.svg) `#262A2E` | Group row, past month |
| `--budget-row-alt-even` | ![#EDF6FF](swatches/EDF6FF.svg) `#EDF6FF` | ![#232B32](swatches/232B32.svg) `#232B32` | ![#EDF6FF](swatches/EDF6FF.svg) `#EDF6FF` | ![#232B32](swatches/232B32.svg) `#232B32` | Sub-category / split rows (even) |
| `--budget-row-alt-odd` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#1E2327](swatches/1E2327.svg) `#1E2327` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#1E2327](swatches/1E2327.svg) `#1E2327` | Sub-category / split rows (odd) |
| `--uncategorized-bg` | ![#FFFCDB](swatches/FFFCDB.svg) `#FFFCDB` | ![#38341E](swatches/38341E.svg) `#38341E` | ![#FFFCDB](swatches/FFFCDB.svg) `#FFFCDB` | ![#38341E](swatches/38341E.svg) `#38341E` | Uncategorized row |
| `--uncategorized-bg-past` | ![#EFF0EF](swatches/EFF0EF.svg) `#EFF0EF` | ![#262A2E](swatches/262A2E.svg) `#262A2E` | ![#EFF0EF](swatches/EFF0EF.svg) `#EFF0EF` | ![#262A2E](swatches/262A2E.svg) `#262A2E` | Uncategorized row, past (new) |
| `--uncategorized-text` | ![#A05D00](swatches/A05D00.svg) `#A05D00` | ![#F0B060](swatches/F0B060.svg) `#F0B060` | ![#A05D00](swatches/A05D00.svg) `#A05D00` | ![#F0B060](swatches/F0B060.svg) `#F0B060` | Uncategorized row text |
| `--hidden-row-text` | ![#444444](swatches/444444.svg) `#444444` | ![#A0A8AE](swatches/A0A8AE.svg) `#A0A8AE` | ![#444444](swatches/444444.svg) `#444444` | ![#A0A8AE](swatches/A0A8AE.svg) `#A0A8AE` | Hidden Categories row (new; was #444444) |
| `--drag-indicator` | ![#555555](swatches/555555.svg) `#555555` | ![#B8C0C5](swatches/B8C0C5.svg) `#B8C0C5` | ![#555555](swatches/555555.svg) `#555555` | ![#B8C0C5](swatches/B8C0C5.svg) `#B8C0C5` | Drop indicator line/border (new; was #555555) |
| `--timeline-no-data-text` | ![#9D9D9D](swatches/9D9D9D.svg) `#9D9D9D` | ![#5E676D](swatches/5E676D.svg) `#5E676D` | ![#9D9D9D](swatches/9D9D9D.svg) `#9D9D9D` | ![#5E676D](swatches/5E676D.svg) `#5E676D` | Timeline months before first data (new; was #9D9D9D) |
| `--header-explanation-amount` | ![#DCDCDC](swatches/DCDCDC.svg) `#DCDCDC` | ![#DCDCDC](swatches/DCDCDC.svg) `#DCDCDC` | ![#DCDCDC](swatches/DCDCDC.svg) `#DCDCDC` | ![#DCDCDC](swatches/DCDCDC.svg) `#DCDCDC` | Header math amounts, year label |
| `--header-equals-sign` | ![#B7B8B7](swatches/B7B8B7.svg) `#B7B8B7` | ![#9EA6AC](swatches/9EA6AC.svg) `#9EA6AC` | ![#B7B8B7](swatches/B7B8B7.svg) `#B7B8B7` | ![#9EA6AC](swatches/9EA6AC.svg) `#9EA6AC` | = sign before Available to Budget (new) |
| `--header-explanation-label` | ![#B6B7B6](swatches/B6B7B6.svg) `#B6B7B6` | ![#A9B0B5](swatches/A9B0B5.svg) `#A9B0B5` | ![#B6B7B6](swatches/B6B7B6.svg) `#B6B7B6` | ![#A9B0B5](swatches/A9B0B5.svg) `#A9B0B5` | Header math labels |
| `--header-bg-current` | ![#3A4A52](swatches/3A4A52.svg) `#3A4A52` | ![#2E3C44](swatches/2E3C44.svg) `#2E3C44` | ![#3A4A52](swatches/3A4A52.svg) `#3A4A52` | ![#2E3C44](swatches/2E3C44.svg) `#2E3C44` | Header gradient top (current/future); bottom below |
| `--header-bg-current-end` | ![#26323A](swatches/26323A.svg) `#26323A` | ![#1A242A](swatches/1A242A.svg) `#1A242A` | ![#26323A](swatches/26323A.svg) `#26323A` | ![#1A242A](swatches/1A242A.svg) `#1A242A` | Header gradient bottom (current/future) (new) |
| `--header-bg-past` | ![#E2E3E2](swatches/E2E3E2.svg) `#E2E3E2` | ![#30363B](swatches/30363B.svg) `#30363B` | ![#E2E3E2](swatches/E2E3E2.svg) `#E2E3E2` | ![#30363B](swatches/30363B.svg) `#30363B` | Past header gradient top |
| `--header-bg-past-end` | ![#CFD0CF](swatches/CFD0CF.svg) `#CFD0CF` | ![#272C30](swatches/272C30.svg) `#272C30` | ![#CFD0CF](swatches/CFD0CF.svg) `#CFD0CF` | ![#272C30](swatches/272C30.svg) `#272C30` | Past header gradient bottom (new) |

## 6. Register

Only the cleared "C" changes in CVD: green becomes blue. Cleared and uncleared also use different glyphs (filled vs outline) in every palette.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--row-alt-even` | ![#EDF6FB](swatches/EDF6FB.svg) `#EDF6FB` | ![#232B32](swatches/232B32.svg) `#232B32` | ![#EDF6FB](swatches/EDF6FB.svg) `#EDF6FB` | ![#232B32](swatches/232B32.svg) `#232B32` | Alternating rows (even) |
| `--row-alt-odd` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#1E2327](swatches/1E2327.svg) `#1E2327` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#1E2327](swatches/1E2327.svg) `#1E2327` | Alternating rows (odd) |
| `--row-selected` | ![#FAF2AF](swatches/FAF2AF.svg) `#FAF2AF` | ![#4A4320](swatches/4A4320.svg) `#4A4320` | ![#FAF2AF](swatches/FAF2AF.svg) `#FAF2AF` | ![#4A4320](swatches/4A4320.svg) `#4A4320` | Selected row |
| `--row-edit-border` | ![#FD9C3C](swatches/FD9C3C.svg) `#FD9C3C` | ![#E08A30](swatches/E08A30.svg) `#E08A30` | ![#FD9C3C](swatches/FD9C3C.svg) `#FD9C3C` | ![#E08A30](swatches/E08A30.svg) `#E08A30` | Editor row border |
| `--row-edit-bg` | ![#FFF0D4](swatches/FFF0D4.svg) `#FFF0D4` | ![#3D2F1A](swatches/3D2F1A.svg) `#3D2F1A` | ![#FFF0D4](swatches/FFF0D4.svg) `#FFF0D4` | ![#3D2F1A](swatches/3D2F1A.svg) `#3D2F1A` | Editor row background |
| `--grid-line-h` | ![#D8D8D8](swatches/D8D8D8.svg) `#D8D8D8` | ![#3A4147](swatches/3A4147.svg) `#3A4147` | ![#D8D8D8](swatches/D8D8D8.svg) `#D8D8D8` | ![#3A4147](swatches/3A4147.svg) `#3A4147` | Horizontal grid lines |
| `--grid-line-v` | ![#E9E9E9](swatches/E9E9E9.svg) `#E9E9E9` | ![#2F353B](swatches/2F353B.svg) `#2F353B` | ![#E9E9E9](swatches/E9E9E9.svg) `#E9E9E9` | ![#2F353B](swatches/2F353B.svg) `#2F353B` | Vertical grid lines |
| `--register-border` | ![#E1E1E1](swatches/E1E1E1.svg) `#E1E1E1` | ![#373E44](swatches/373E44.svg) `#373E44` | ![#E1E1E1](swatches/E1E1E1.svg) `#E1E1E1` | ![#373E44](swatches/373E44.svg) `#373E44` | Borders, split sub-row bottom |
| `--register-gray-bg` | ![#EDEDED](swatches/EDEDED.svg) `#EDEDED` | ![#2A2F34](swatches/2A2F34.svg) `#2A2F34` | ![#EDEDED](swatches/EDEDED.svg) `#EDEDED` | ![#2A2F34](swatches/2A2F34.svg) `#2A2F34` | Gray backgrounds |
| `--split-border` | ![#FFD28A](swatches/FFD28A.svg) `#FFD28A` | ![#8A6A30](swatches/8A6A30.svg) `#8A6A30` | ![#FFD28A](swatches/FFD28A.svg) `#FFD28A` | ![#8A6A30](swatches/8A6A30.svg) `#8A6A30` | Split editor border |
| `--split-text` | ![#8E5000](swatches/8E5000.svg) `#8E5000` | ![#F0B060](swatches/F0B060.svg) `#F0B060` | ![#8E5000](swatches/8E5000.svg) `#8E5000` | ![#F0B060](swatches/F0B060.svg) `#F0B060` | Sub-transaction text |
| `--search-bar-rule` | ![#46575E](swatches/46575E.svg) `#46575E` | ![#5A6A72](swatches/5A6A72.svg) `#5A6A72` | ![#46575E](swatches/46575E.svg) `#46575E` | ![#5A6A72](swatches/5A6A72.svg) `#5A6A72` | 1 px panel rules |
| `--summary-divider` | ![#A3A3A3](swatches/A3A3A3.svg) `#A3A3A3` | ![#5C656B](swatches/5C656B.svg) `#5C656B` | ![#A3A3A3](swatches/A3A3A3.svg) `#A3A3A3` | ![#5C656B](swatches/5C656B.svg) `#5C656B` | Summary box dividers |
| `--grid-header-bg` | ![#3A4A52](swatches/3A4A52.svg) `#3A4A52` | ![#2E3C44](swatches/2E3C44.svg) `#2E3C44` | ![#3A4A52](swatches/3A4A52.svg) `#3A4A52` | ![#2E3C44](swatches/2E3C44.svg) `#2E3C44` | Grid header (same gradient as month header) |
| `--running-balance-text` | ![#6B6B6B](swatches/6B6B6B.svg) `#6B6B6B` | ![#ABB2B6](swatches/ABB2B6.svg) `#ABB2B6` | ![#6B6B6B](swatches/6B6B6B.svg) `#6B6B6B` | ![#ABB2B6](swatches/ABB2B6.svg) `#ABB2B6` | Running balance column |
| `--cleared-on` | ![#56A537](swatches/56A537.svg) `#56A537` | ![#6CC24A](swatches/6CC24A.svg) `#6CC24A` | **![#0072B2](swatches/0072B2.svg) `#0072B2`** | **![#56B4E9](swatches/56B4E9.svg) `#56B4E9`** | Cleared 'C' (new; was green) |
| `--cleared-off` | ![#B0B0B0](swatches/B0B0B0.svg) `#B0B0B0` | ![#5E676D](swatches/5E676D.svg) `#5E676D` | ![#B0B0B0](swatches/B0B0B0.svg) `#B0B0B0` | ![#5E676D](swatches/5E676D.svg) `#5E676D` | Uncleared 'C' (new; was gray) |

## 7. Error levels

In CVD, error becomes a dark vermillion and needsCategory a bright yellow, so the two differ in lightness as well as hue.

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--error-row-bg` | ![#FFECEC](swatches/FFECEC.svg) `#FFECEC` | ![#3A2224](swatches/3A2224.svg) `#3A2224` | **![#FDEBE1](swatches/FDEBE1.svg) `#FDEBE1`** | **![#3A2618](swatches/3A2618.svg) `#3A2618`** | error: row background |
| `--error-row-border` | ![#EA9797](swatches/EA9797.svg) `#EA9797` | ![#8A4A4A](swatches/8A4A4A.svg) `#8A4A4A` | **![#A84A1A](swatches/A84A1A.svg) `#A84A1A`** | **![#D0703A](swatches/D0703A.svg) `#D0703A`** | error: row border |
| `--error-pill-bg` | ![#F2C7C4](swatches/F2C7C4.svg) `#F2C7C4` | ![#5C2A2A](swatches/5C2A2A.svg) `#5C2A2A` | **![#F6CDB8](swatches/F6CDB8.svg) `#F6CDB8`** | **![#5E3216](swatches/5E3216.svg) `#5E3216`** | error: pill |
| `--error-pill-text` | ![#A72522](swatches/A72522.svg) `#A72522` | ![#FF9C94](swatches/FF9C94.svg) `#FF9C94` | **![#9A3300](swatches/9A3300.svg) `#9A3300`** | **![#FFA066](swatches/FFA066.svg) `#FFA066`** | error: pill text |
| `--error-badge` | ![#D14238](swatches/D14238.svg) `#D14238` | ![#DA372A](swatches/DA372A.svg) `#DA372A` | **![#B8400A](swatches/B8400A.svg) `#B8400A`** | **![#C05422](swatches/C05422.svg) `#C05422`** | error: badge (white text) |
| `--review-row-bg` | ![#F5F7FF](swatches/F5F7FF.svg) `#F5F7FF` | ![#22283A](swatches/22283A.svg) `#22283A` | ![#F5F7FF](swatches/F5F7FF.svg) `#F5F7FF` | ![#22283A](swatches/22283A.svg) `#22283A` | forReview: row background |
| `--review-row-border` | ![#96A6D9](swatches/96A6D9.svg) `#96A6D9` | ![#4E5E94](swatches/4E5E94.svg) `#4E5E94` | ![#96A6D9](swatches/96A6D9.svg) `#96A6D9` | ![#4E5E94](swatches/4E5E94.svg) `#4E5E94` | forReview: row border |
| `--review-badge` | ![#506FD2](swatches/506FD2.svg) `#506FD2` | ![#4D6EDA](swatches/4D6EDA.svg) `#4D6EDA` | **![#3D63D0](swatches/3D63D0.svg) `#3D63D0`** | **![#466DE3](swatches/466DE3.svg) `#466DE3`** | forReview: badge (white text) |
| `--needscat-row-bg` | ![#FFF8C7](swatches/FFF8C7.svg) `#FFF8C7` | ![#36321C](swatches/36321C.svg) `#36321C` | ![#FFF8C7](swatches/FFF8C7.svg) `#FFF8C7` | ![#36321C](swatches/36321C.svg) `#36321C` | needsCategory: row background |
| `--needscat-row-border` | ![#B5B08F](swatches/B5B08F.svg) `#B5B08F` | ![#7A6F3A](swatches/7A6F3A.svg) `#7A6F3A` | **![#E6D46A](swatches/E6D46A.svg) `#E6D46A`** | **![#5E5520](swatches/5E5520.svg) `#5E5520`** | needsCategory: row border |
| `--needscat-pill-bg` | ![#FFD796](swatches/FFD796.svg) `#FFD796` | ![#5E4A1E](swatches/5E4A1E.svg) `#5E4A1E` | **![#FBE38A](swatches/FBE38A.svg) `#FBE38A`** | **![#5A4E12](swatches/5A4E12.svg) `#5A4E12`** | needsCategory: pill |
| `--needscat-pill-text` | ![#8E5200](swatches/8E5200.svg) `#8E5200` | ![#F5C06A](swatches/F5C06A.svg) `#F5C06A` | **![#6B5600](swatches/6B5600.svg) `#6B5600`** | **![#F5DC6A](swatches/F5DC6A.svg) `#F5DC6A`** | needsCategory: pill text |
| `--needscat-badge` | ![#E8A33C](swatches/E8A33C.svg) `#E8A33C` | ![#E8A33C](swatches/E8A33C.svg) `#E8A33C` | **![#F0C419](swatches/F0C419.svg) `#F0C419`** | **![#F0C419](swatches/F0C419.svg) `#F0C419`** | needsCategory: badge |
| `--needscat-badge-text` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | needsCategory: badge text (new) |
| `--badge-text` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | error / forReview badge counts (new) |
| `--notifier-error-bg` | ![#FFE4E1](swatches/FFE4E1.svg) `#FFE4E1` | ![#3D2420](swatches/3D2420.svg) `#3D2420` | **![#FDE6DA](swatches/FDE6DA.svg) `#FDE6DA`** | **![#3D2A1A](swatches/3D2A1A.svg) `#3D2A1A`** | Error notifier strip |
| `--notifier-error-border` | ![#E12C19](swatches/E12C19.svg) `#E12C19` | ![#E85A48](swatches/E85A48.svg) `#E85A48` | **![#C24A12](swatches/C24A12.svg) `#C24A12`** | **![#E07A3A](swatches/E07A3A.svg) `#E07A3A`** | Error notifier border |

## 8. Tags

Actual tag-entity colors are user data shared across clients, so they are not transformed by palette or CVD settings. Every tag pill includes its `#name`; choose black or white foreground text to maximize contrast against its stored color. When no entity color exists, use `--tag-default-bg` from `05` §1.7. User-selected tag colors are not part of the palette separation calculations.

## 9. Components

| Token | Light | Dark | Light CVD | Dark CVD | Use |
| --- | --- | --- | --- | --- | --- |
| `--callout-bg-start` | ![#F0F0F0](swatches/F0F0F0.svg) `#F0F0F0` | ![#2C3236](swatches/2C3236.svg) `#2C3236` | ![#F0F0F0](swatches/F0F0F0.svg) `#F0F0F0` | ![#2C3236](swatches/2C3236.svg) `#2C3236` | Callout gradient top |
| `--callout-bg-end` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#252A2E](swatches/252A2E.svg) `#252A2E` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#252A2E](swatches/252A2E.svg) `#252A2E` | Callout gradient bottom |
| `--callout-help-bg` | ![#FFF7C2](swatches/FFF7C2.svg) `#FFF7C2` | ![#3A3520](swatches/3A3520.svg) `#3A3520` | ![#FFF7C2](swatches/FFF7C2.svg) `#FFF7C2` | ![#3A3520](swatches/3A3520.svg) `#3A3520` | Help callout |
| `--callout-help-border` | ![#E5D27A](swatches/E5D27A.svg) `#E5D27A` | ![#7A6C34](swatches/7A6C34.svg) `#7A6C34` | ![#E5D27A](swatches/E5D27A.svg) `#E5D27A` | ![#7A6C34](swatches/7A6C34.svg) `#7A6C34` | Help callout border |
| `--tooltip-bg` | ![#FFFFE1](swatches/FFFFE1.svg) `#FFFFE1` | ![#2C3236](swatches/2C3236.svg) `#2C3236` | ![#FFFFE1](swatches/FFFFE1.svg) `#FFFFE1` | ![#2C3236](swatches/2C3236.svg) `#2C3236` | Tooltip |
| `--tooltip-border` | ![#767676](swatches/767676.svg) `#767676` | ![#5C656B](swatches/5C656B.svg) `#5C656B` | ![#767676](swatches/767676.svg) `#767676` | ![#5C656B](swatches/5C656B.svg) `#5C656B` | Tooltip border |
| `--banner-bg` | ![#FFF3C4](swatches/FFF3C4.svg) `#FFF3C4` | ![#3A3520](swatches/3A3520.svg) `#3A3520` | ![#FFF3C4](swatches/FFF3C4.svg) `#FFF3C4` | ![#3A3520](swatches/3A3520.svg) `#3A3520` | ConnectionBanner |
| `--banner-border` | ![#E0C060](swatches/E0C060.svg) `#E0C060` | ![#8A7A3A](swatches/8A7A3A.svg) `#8A7A3A` | ![#E0C060](swatches/E0C060.svg) `#E0C060` | ![#8A7A3A](swatches/8A7A3A.svg) `#8A7A3A` | ConnectionBanner bottom border |
| `--overlay-bg` | ![#2F3A40](swatches/2F3A40.svg) `#2F3A40` | ![#0E1215](swatches/0E1215.svg) `#0E1215` | ![#2F3A40](swatches/2F3A40.svg) `#2F3A40` | ![#0E1215](swatches/0E1215.svg) `#0E1215` | LoadingOverlay box (90%) |
| `--overlay-shadow` | ![#292F33](swatches/292F33.svg) `#292F33` | ![#000000](swatches/000000.svg) `#000000` | ![#292F33](swatches/292F33.svg) `#292F33` | ![#000000](swatches/000000.svg) `#000000` | Scrim and overlay shadows |
| `--button-primary-start` | ![#528200](swatches/528200.svg) `#528200` | ![#4B7B00](swatches/4B7B00.svg) `#4B7B00` | ![#528200](swatches/528200.svg) `#528200` | ![#4B7B00](swatches/4B7B00.svg) `#4B7B00` | Primary button gradient top |
| `--button-primary-end` | ![#456E00](swatches/456E00.svg) `#456E00` | ![#3F6800](swatches/3F6800.svg) `#3F6800` | ![#456E00](swatches/456E00.svg) `#456E00` | ![#3F6800](swatches/3F6800.svg) `#3F6800` | Primary button gradient bottom |
| `--button-bg` | ![#EDEDED](swatches/EDEDED.svg) `#EDEDED` | ![#363D43](swatches/363D43.svg) `#363D43` | ![#EDEDED](swatches/EDEDED.svg) `#EDEDED` | ![#363D43](swatches/363D43.svg) `#363D43` | Standard button |
| `--button-save-bg` | ![#528200](swatches/528200.svg) `#528200` | ![#4B7B00](swatches/4B7B00.svg) `#4B7B00` | **![#0072B2](swatches/0072B2.svg) `#0072B2`** | **![#0072B2](swatches/0072B2.svg) `#0072B2`** | Save-tone button: editor Save and add another / Save / Done / Approve and find next / Approve, Schedule dialog Save / Add (new) |
| `--button-cancel-bg` | ![#D14238](swatches/D14238.svg) `#D14238` | ![#DA372A](swatches/DA372A.svg) `#DA372A` | **![#B8400A](swatches/B8400A.svg) `#B8400A`** | **![#C05422](swatches/C05422.svg) `#C05422`** | Cancel-tone button: Cancel, the editor's Delete; aliases `--error-badge` (new) |
| `--button-tone-text` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` | Label on a toned button (new) |
| `--news-badge` | ![#FFD84D](swatches/FFD84D.svg) `#FFD84D` | ![#FFD84D](swatches/FFD84D.svg) `#FFD84D` | ![#FFD84D](swatches/FFD84D.svg) `#FFD84D` | ![#FFD84D](swatches/FFD84D.svg) `#FFD84D` | The notifications bell's unread badge (new) |
| `--news-badge-text` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | ![#2F302F](swatches/2F302F.svg) `#2F302F` | The bell badge's count (new) |
| `--news-pill-release-bg` | ![#E5F0D3](swatches/E5F0D3.svg) `#E5F0D3` | ![#2D3B1C](swatches/2D3B1C.svg) `#2D3B1C` | ![#E5F0D3](swatches/E5F0D3.svg) `#E5F0D3` | ![#2D3B1C](swatches/2D3B1C.svg) `#2D3B1C` | "Release" type pill (new) |
| `--news-pill-release-text` | ![#3D6100](swatches/3D6100.svg) `#3D6100` | ![#B9DE84](swatches/B9DE84.svg) `#B9DE84` | ![#3D6100](swatches/3D6100.svg) `#3D6100` | ![#B9DE84](swatches/B9DE84.svg) `#B9DE84` | "Release" pill text (new) |
| `--news-pill-post-bg` | ![#DDEBF6](swatches/DDEBF6.svg) `#DDEBF6` | ![#1A3347](swatches/1A3347.svg) `#1A3347` | ![#DDEBF6](swatches/DDEBF6.svg) `#DDEBF6` | ![#1A3347](swatches/1A3347.svg) `#1A3347` | "Post" type pill (new) |
| `--news-pill-post-text` | ![#00507E](swatches/00507E.svg) `#00507E` | ![#93CFF2](swatches/93CFF2.svg) `#93CFF2` | ![#00507E](swatches/00507E.svg) `#00507E` | ![#93CFF2](swatches/93CFF2.svg) `#93CFF2` | "Post" pill text (new) |

## 10. Design notes

| Topic | Choice |
| --- | --- |
| Default appearance | `system`: follow the OS. |
| One CVD variant | One color-blind option, tuned for red-green and checked against tritanopia. There are no separate protan / deutan / tritan modes. |
| Printing | Prints and PDFs always use Light, or Light CVD when CVD is on. Dark mode users never get dark prints. |
| Contrast exceptions | The reference Light values that miss their contrast target are changed in Light and Light CVD, instead of matching the reference exactly (reference → Actuality): `--negative-on-blue` ![#FFB4B5](swatches/FFB4B5.svg) `#FFB4B5` → ![#FFF5F5](swatches/FFF5F5.svg) `#FFF5F5` (Light CVD ![#FFC98F](swatches/FFC98F.svg) `#FFC98F` → ![#FFF6EB](swatches/FFF6EB.svg) `#FFF6EB`), `--atb-negative` ![#E38E88](swatches/E38E88.svg) `#E38E88` → ![#E9A6A1](swatches/E9A6A1.svg) `#E9A6A1`, `--needscat-pill-text` ![#A05D00](swatches/A05D00.svg) `#A05D00` → ![#8E5200](swatches/8E5200.svg) `#8E5200`, `--needscat-badge-text` ![#FFFFFF](swatches/FFFFFF.svg) `#FFFFFF` → ![#2F302F](swatches/2F302F.svg) `#2F302F`, `--cleared-on` ![#5BAE3A](swatches/5BAE3A.svg) `#5BAE3A` → ![#56A537](swatches/56A537.svg) `#56A537`. |
| Large-text threshold and missing pairs | WCAG's large text is 18 pt / 14 pt bold (24 px / 18.67 px bold), not 18 px / 14 px bold, and the check covers every pair a chapter uses. Under it, seven more Light values change: `--app-bg` ![#2C98C6](swatches/2C98C6.svg) `#2C98C6` → ![#22779B](swatches/22779B.svg) `#22779B` (white sidebar text would be 3.27:1), `--accent-blue` ![#0082CB](swatches/0082CB.svg) `#0082CB` → ![#006FAE](swatches/006FAE.svg) `#006FAE`, `--money-positive` ![#62A000](swatches/62A000.svg) `#62A000` → ![#508200](swatches/508200.svg) `#508200`, `--atb-past` ![#D0D0D0](swatches/D0D0D0.svg) `#D0D0D0` → ![#575757](swatches/575757.svg) `#575757` (past headers would be 1.0–1.2:1), `--header-equals-sign` ![#808180](swatches/808180.svg) `#808180` → ![#B7B8B7](swatches/B7B8B7.svg) `#B7B8B7`, `--running-balance-text` ![#A5A5A5](swatches/A5A5A5.svg) `#A5A5A5` → ![#6B6B6B](swatches/6B6B6B.svg) `#6B6B6B`, `--text-strike` ![#8B8D8B](swatches/8B8D8B.svg) `#8B8D8B` → ![#6A6C6A](swatches/6A6C6A.svg) `#6A6C6A`. Dark: `--atb-past` → `#97A0A7`, `--header-equals-sign` → `#9EA6AC`, `--running-balance-text` → `#ABB2B6`, `--text-strike` → `#ACB2B5`. The focus ring uses `--text-on-blue` on the blue background. `--money-positive` vs `--money-negative-strong` in Light drops to ΔE 7.9 under simulated CVD; the target applies only to the CVD palettes. |
| Badge counts | With the base badge colors, the white badge counts (bold `sm`) on the error and review badges would be 3.44–3.98:1 in several palettes. So `--review-badge` is ![#506FD2](swatches/506FD2.svg) `#506FD2` in Light; Dark `--error-badge` ![#DA372A](swatches/DA372A.svg) `#DA372A`, `--review-badge` ![#4D6EDA](swatches/4D6EDA.svg) `#4D6EDA`; Dark CVD `--error-badge` ![#C05422](swatches/C05422.svg) `#C05422`, `--review-badge` ![#466DE3](swatches/466DE3.svg) `#466DE3`. The badges stay well apart under simulated CVD (ΔE ≥ 39.7). |
| Primary button label | White text on the reference green primary button would be 2.91–3.79:1 (Light) and 3.15–4.25:1 (Dark), below 4.5:1 for its 14 px label. So `--button-primary-start` / `--button-primary-end` are ![#528200](swatches/528200.svg) `#528200` / ![#456E00](swatches/456E00.svg) `#456E00` in Light and ![#4B7B00](swatches/4B7B00.svg) `#4B7B00` / ![#3F6800](swatches/3F6800.svg) `#3F6800` in Dark. |
| Running-app audit | axe-core on the running app checks what the token pairs can't. The TaskDialog instruction (`--accent-green` on `--panel-bg`, 18.2 px bold, under the large-text size) would be 2.91:1 with the reference value, so `--accent-green` is ![#4F7D00](swatches/4F7D00.svg) `#4F7D00` in Light and Light CVD. CSS rules with no token change: grid header text uses `--text-on-blue` (`--panel-bg` would be dark on dark in Dark), zero amounts use `--text-muted` (`--text-subtle` on a hovered row) instead of half opacity, text on `--accent-blue` is `--panel-bg`, the timeline's "also visible" and "current + selected" mixes keep 80 % and 90 % of their color, and a selected error badge is ringed instead of lightened. |
