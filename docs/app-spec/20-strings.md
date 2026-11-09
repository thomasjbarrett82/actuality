# 20 — Strings & Internationalization

## 1. Approach

- Every user-visible string goes through **vue-i18n**: `t('bundle.key', params)` in the renderer. Main and host messages that reach the user are sent as keys + params, never as English text, except Actual's own error `message`, which is shown verbatim as a fallback.
- Message files live in `src/shared/i18n/en/{bundle}.json` (§3.1). The target catalog uses Actuality-owned messages organized by product feature (§4); new or re-authored copy must not be copied or generated from another application's resource catalog. Literal strings in chapters `03`–`18` are requirements for Actuality's user experience. If a phrase's provenance is uncertain, treat it as draft copy and write it independently from the described task, state, and behavior before shipping.
- **Placeholders** follow vue-i18n's message syntax, and one message uses one style only:
  - **Named**, `{url}`, `{name}`, `{account}`, `{amount}`: params are an object. Prefer descriptive names for new messages.
  - **Positional**, `{0}`, `{1}`: params are an array. Only when an external format requires it; the catalog uses named placeholders throughout.
  - `{n}` is the count in plural strings.
  - vue-i18n resolves `{0}` only from an array: an object with a `0` key renders nothing (vue-i18n 11.4).

  A chapter that quotes a string writes the placeholder names the message file uses. `i18n:check` (§3.7) compares the **set of placeholders** in each translation with the `en` value.

- HTML fragments (`**`, `*`, `<br/>`, links) are rendered only through the sanitized rich-text component (`17` §1). Never use `v-html` with unsanitized strings.
- **Product name:** user-facing strings use the literal `Actuality` wherever they refer to the application.
- Plurals: vue-i18n plural forms; author each new or re-authored form for Actuality.
- Only English ships. §3 says how to add more languages. Number and date formatting comes from the budget's Actual prefs, not the UI locale (`07` §4.2).

## 2. Copy requirements

Feature chapters describe the purpose, context, and behavior of user-facing text. Write the English source copy for Actuality from those requirements; do not use another application's resource files, resource identifiers, or distinctive wording as a source. Screenshots and observed workflows may inform layout and intent, but are not a source for hidden implementation details.

Keep copy concise, specific to the action or state, and consistent across the app. Use platform-standard labels only where they are necessary for familiar controls. Accessible names, descriptions, and announcements (`22` §4) must communicate the same intent as their visible controls.

## 3. Adding a language

Only English ships. Every rule below is in place, so adding a language means translating files, with no code changes.

### 3.1 Locale files

- Message files live in `src/shared/i18n/{locale}/{bundle}.json`, one folder per locale. `{locale}` is a BCP 47 tag: a language (`de`), or a language and region when they differ (`pt-BR`). The files are in `src/shared` because both the renderer (vue-i18n) and main (menus and native dialogs, §3.4) read them.
- Each folder also holds a `meta.json`: `{ "name": "Deutsch", "englishName": "German", "dateFnsLocale": "de", "dir": "ltr" }`. `name` is the language's name in that language, shown in Preferences.
- Locales are discovered at build time (`import.meta.glob('…/i18n/*/meta.json')`), so adding a folder registers the locale. The code keeps no list of locales.
- `en` is the **source locale**. Every other locale has exactly the bundles and keys that `en` has.

### 3.2 Adding a locale

1. Copy `src/shared/i18n/en/` to `src/shared/i18n/{locale}/` and fill in `meta.json`.
2. Translate the values. Leave unchanged: the app-owned keys, placeholders, the product name `Actuality`, rich-text markup, and plural separators. Plural forms follow the language's CLDR rules. If the language doesn't use English's one/other split, add a `pluralRules` entry for it in `src/renderer/i18n.ts`.
3. Run `npm run i18n:check` (§3.7) and fix every error.
4. Look through the screens in the running app (§3.6). Shorten any translation that still doesn't fit.

The UI text quoted in chapters `03`–`18` is the English source. Translations don't have to follow it word for word.

### 3.3 Choosing the language

- The preference `language` (`19` §1) is `'system'` (the default) or a locale tag. It's set in Preferences (`07` §7).
- With `'system'`, main matches `app.getPreferredSystemLanguages`, in order, against the shipped locales: first the exact tag (`pt-BR`), then the language alone (`pt`). If nothing matches, it uses `en`.
- A change applies immediately, with no restart: the renderer switches the vue-i18n locale and main rebuilds the native menus.
- The UI language sets the text and the date-fns locale (month and weekday names in the timeline and date pickers). It does **not** set number, currency or date *formats*. Those come from the budget's Actual settings (§1, `07` §4.2), so two people sharing a budget see the same formats in different languages. The calendar's first weekday comes from the budget's `firstDayOfWeekIdx` preference when set; otherwise, it follows the UI locale's week start (`04` §3, `07` §4).

### 3.4 Main process and API host

- Main doesn't run vue-i18n. It translates with a small `t(key, params)` from `src/shared/i18n/translate.ts`, which reads the same JSON files and uses the same fallback (§3.5). Main uses it for native menu labels (`06` §4), native dialog titles and buttons, the print preview window title and the window title.
- The host never formats user-visible text. It sends keys and parameters (§1), and the renderer or main translates them.

### 3.5 Missing keys and fallback

- The fallback chain is: the chosen locale → its language alone (`pt-BR` → `pt`) → `en`. The user never sees a raw key.
- In development builds, a missing key logs a warning naming the key and the locale. In release builds it falls back silently.
- A locale **ships** only when `i18n:check` passes with no missing keys. Incomplete locales can live in the repo, but Preferences lists them only in development builds.

### 3.6 Layout and scripts

- Sizes come from the `rem` tokens in `05` §3, and containers size to their content between a minimum and a maximum. Longer text widens buttons, menu items, popovers and dialogs up to their maximum width, and grows rows and dialogs taller. Only where a width is fixed by the layout (the sidebar, grid columns, the budget category column) are labels cut off with an ellipsis, with the full text in a tooltip and the accessible name (`22` §4.3).
- Translations should be no more than about 130% of the English length.
- Development builds include a **pseudo-locale**, `en-XA`. It's generated from `en` at build time: every value is wrapped in `［ ］` (fullwidth brackets, not the `⟦ ⟧` of the check-number note token, `04` §5.1, in case a pseudo-localized name is written into budget data), accented (`Budget` → `Ƀüđğéţ`) and padded by 40%. It shows text that wasn't translated (it has no brackets) and text that overflows.
- Source Sans 3 covers Latin, Greek and Cyrillic. Other scripts (CJK, Arabic, Hebrew, Thai, Devanagari, …) fall back to the OS fonts through `system-ui`. The app ships no other fonts.
- Right-to-left languages are **out of scope**, so `i18n:check` rejects `"dir": "rtl"` in `meta.json`. They would need mirrored layouts, which is a separate project.

### 3.7 Checks

`npm run i18n:check` runs in CI (`21` §1). It fails when any locale has:

- a key that's missing compared with `en` (an error for shipped locales, a warning for development-only ones), or a key that `en` doesn't have;
- a value whose placeholders differ from the `en` value's, or whose rich-text markup doesn't parse;
- a plural value with the wrong number of forms for its language;
- a missing or invalid `meta.json`, or one that names a date-fns locale that doesn't exist.

It also fails when code passes `t` a key that `en` doesn't have, or when an `en` key isn't used anywhere in `src/` and isn't listed in `scripts/i18n-pending.json` (keys no feature uses yet; a listed key that becomes used must be removed from the list). Code names keys as quoted `bundle.key` literals, never built from parts, so this check can find them.

### 3.8 Text that isn't translated

Some text is written into Actual's data, or belongs to a file format or a machine-readable syntax. It follows these rules:

| Text | Rule |
| --- | --- |
| Names and descriptions the app writes into the budget, including template categories and groups (`07` §4.1), the reconciliation adjustment's notes (`13` §6.3), notes, and tag descriptions (`04` §5.2) | Written in the UI language **when they're created**, and never re-translated. They're the user's data, shared with other devices and Actual web. The app never looks these items up by name: it uses ids, Actual flags (`starting_balance_flag`) or metadata ids. |
| Tag names (`#needs-review` and user-created `#tags`), note tokens (`⟦chk n⟧`), reserved note ids (`ad:…`) | Never translated, because they're identifiers. |
| Register search terms (`10` §4) | Shown and suggested in the UI language. The parser also accepts English, so English typed by the user and searches written before a language change keep working. |
| Import and export file formats: CSV column headers, QIF codes, OFX tags (`16`) | Always English. Exported CSV headers are English in every UI language, so the files can be re-imported anywhere. |
| Actual's own error `message` | Shown as Actual sends it (§1). |
| News feed entries: titles, bodies and lists of changes (`24` §4) | Shown as the blog publishes them, in English. The app's own text around them (the dialog, the bell, the toasts, the type pills) goes through i18n, and feed dates are formatted in the UI language (`24` §4.6). |
| Printed budgets, registers and PDFs | In the UI language. |

## 4. Actuality message organization

Message bundles and keys are part of Actuality's own implementation. Use bundle names that describe product areas, and stable `camelCase` keys that describe a message's meaning or use. Do not preserve identifiers from another application's resources or organize Actuality's messages to mirror another product's internal structure.

The `en` message files are the string catalog: chapters `03`–`24` quote their values. The bundles are:

| Bundle | Content |
| --- | --- |
| `app` | Most of the app's text: start screens, connection states, dialogs, Preferences, schedules, import and export, notifications, and other cross-feature messages |
| `budget` | Budget screen column and row labels |
| `register` | Register columns and transaction-entry messages |
| `accounts` | Account creation, closing and balance labels, and the reconciliation adjustment's notes |
| `navigation` | Sidebar destinations |
| `menu` | Native menu labels and commands (`06` §4), translated by main (§3.4) |
| `files` | The file-type filter name in the import file dialog (`16` §1) |
| `taskDialog` | The standard task dialog buttons (`17` §1) |
| `templates` | Category and group names for budget templates (`07` §4.1) |
| `reports` | Report tabs, filters and selections, chart/table labels, Money Age, saved filters, status and export/print messages (`15`) |
| `search` | Search syntax labels and suggestions (`10` §4) |
| `shortcuts` | The Keyboard Shortcuts dialog: descriptions, sections and key names |
| `a11y` | Accessible names, descriptions, and announcements (`22`) |

A new message goes in the bundle for its feature, or in `app` when no feature bundle fits. Keep keys stable when wording changes; do not encode English text, source-product terminology, or implementation details in a key. Locale-specific date, number, and currency formatting belongs to the relevant formatting APIs and Actual budget preferences, not to string resources.

### 4.1 Reports catalog requirements

The `reports` bundle covers every visible or accessible Reports string required by `15`, including:

- the five tab names, page headings, chart titles/descriptions, table captions/headers, axis labels, legends, series names, units, and tooltips;
- filter and option names, select-all/none actions, selected-count labels, search/no-match text, group controls, date presets/range validation, comparison-period controls, and Use linked filters;
- the Timeframe callout title, **From:** and **To:** endpoint labels, and accessible names for the separate month and year controls for each endpoint (`15` §2.2); the Compare Period dialog title, **Week**, **Month**, **Quarter**, **Year**, **Period:**, and **Compared with the previous period:** labels and the period names shown in its selector and comparison preview (`15` §4.3);
- saved-filter menu states, name input, duplicate/empty validation, save/replace/load/delete confirmations, and saved-filter summaries;
- loading, refreshing, stale/offline, error/retry, empty, zero-data, partial Money Age/coverage, and unavailable-future-period states, plus the localized Money Age explanation required by `15` §5, including its FIFO, historical coverage, purchase-date treatment, and non-comparability with similarly named metrics;
- CSV/Print menu items, file names and dialog labels, progress, success, cancel, and failure messages, including the privacy-mode behavior of CSV versus Print.

All dates, currencies, amounts, and percentages are formatted by existing APIs; do not encode symbols, date patterns, or translated values in message keys or report data. Accessible names, descriptions, and announcements communicate the same meaning as visible text.
