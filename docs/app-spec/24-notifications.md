# 24 — Notifications: Update Check and News Feed

Actuality tells users when a newer version has been published, and when the project has published release notes or announcements. It shows them through a bell in the sidebar, a Notifications dialog, two toasts, a status line in the About dialog, and two preferences that turn each part off.

## 1. Overview

The feature has **two independent subsystems**, each with its own preference:

| Subsystem | Question it answers | Data source | UI |
| --- | --- | --- | --- |
| **Update check** (§3) | "Has a newer version than the one I'm running been published?" | GitHub's "latest release" endpoint for `thomasjbarrett82/actuality` | One dismissible toast; a status line in the About dialog |
| **News feed** (§4) | "What has the project published that I haven't seen?" | `https://actualitydesktop.org/news.json`, the static feed built from the blog (`02` §3.1) | The bell with an unread badge in the sidebar; the Notifications dialog; a one-time "what's new" toast after an upgrade |

They are separate so that:

- A user can get update alerts without fetching news, or the reverse.
- Each one fails on its own. If one host can't be reached, the other still works.
- The news feed announces releases **at or below** the running version (what the user just got), and the update check announces releases **above** it (what they could get). They never announce the same thing twice (§6).
- The update check reads only **published** GitHub releases. The feed can't serve as the update source, because a release's feed entry goes live when the release pull request merges, while the release itself is still a draft (§9).

Terms used in this chapter:

| Term | Meaning |
| --- | --- |
| **Client version** | `AppInfo.version` (`shell.appInfo()`, `18` §1): the `package.json` version the build was made from, e.g. `0.2.1`. |
| **Latest version** | The newest published, non-pre-release GitHub release, as `X.Y.Z`. |
| **Feed** | The news feed of `02` §3.1. |
| **Entry** | One item in the feed: a `release` or a `post`. |
| **Timestamp** | An instant in the canonical form `YYYY-MM-DDTHH:MM:SSZ`, always UTC (`CANONICAL_TIMESTAMP` in `src/shared/news/feed.ts`). |
| **Last-seen timestamp** | The device's high-water mark for the news feed. Entries whose timestamp is strictly after it are _unseen_. |
| **Toast** | A message in the toast stack (§5) with a title, a message, one action button and a close button. |

## 2. Preferences

All four keys are **app preferences** in `settings.json` (`19` §1), owned by main. They apply to the OS user on this computer, not to a budget, so a notification dismissed with one budget open stays dismissed for every budget. They are never synced.

| Key | Type | Default | Purpose |
| --- | --- | --- | --- |
| `notifyWhenUpdateIsAvailable` | bool | `true` | Turns on the update check. When `false`, main never contacts GitHub. |
| `showNewsFeed` | bool | `true` | Turns on the news feed. When `false`, main never fetches the feed, the bell and the Help menu item are hidden, and no "what's new" toast is shown. |
| `lastSeenNewsAt` | string (canonical timestamp) \| null | `null` | The read state's high-water mark (§4.4). Validated with `CANONICAL_TIMESTAMP`; any other value reads as `null`. |
| `updateNotificationShownForVersion` | string (`X.Y.Z`) \| null | `null` | The latest version whose update toast was closed on this device (§3.3). Validated with `RELEASE_VERSION`; any other value reads as `null`. |

- **Both subsystems default to on.** Their requests are anonymous `GET`s of public files (§7), and the Preferences hints name the host each one contacts.
- **Defaults on read** follow the settings store's rule (`19`): a missing, invalid or damaged key falls back to its default.
- All four keys are renderer-writable (`RENDERER_WRITABLE_APP_KEYS`, `19`).

### 2.1 Preferences screen

The section **Updates and News** of the Preferences screen (`07` §7) comes after File Associations and before Diagnostics:

- [x] "Display a notification when updates are available" (`notifyWhenUpdateIsAvailable`), with the hint "Actuality checks api.github.com for a new version when it starts and once a day. Nothing about you or your budgets is sent."
- [x] "Show in-app notifications (release notes and announcements)" (`showNewsFeed`), with the hint "Actuality downloads the latest posts from actualitydesktop.org. Nothing about you or your budgets is sent."

Each hint is the checkbox's accessible description. Both take effect at once, with no restart:

- Turning on the update check runs it straight away (§3.1), so the About status line fills in without a restart.
- Turning off either one removes that subsystem's toast if it is showing, and hides what it shows.

### 2.2 About dialog

The About dialog ("About Actuality", `18` §1) has a status line right below "Version: {version} ({sha})":

| Update check | Result | Status line |
| --- | --- | --- |
| on | outdated | the link "New version available: {version}", which opens the release post `https://actualitydesktop.org/blog/release-{version}` externally |
| on | up to date (including a development build ahead of the latest release) | "You're up to date!" |
| on | still checking, or unknown (offline, error) | nothing |
| off | — | nothing |

Below the version lines, a **Release notes** link opens `https://actualitydesktop.org/blog/tags/release` externally. About doesn't link to the Notifications dialog, because that would put a second dialog on top of About; the bell and the Help menu item (§4.6) open it.

## 3. Update check

### 3.1 Fetching the latest version

1. The check is a Vue Query query, `['updates', 'latest']`, enabled only while `notifyWhenUpdateIsAvailable` is on (§4.3, Caching). It runs when the app starts, on every screen (start screens included), and again on window focus once its result is more than 24 hours old. Enabling the query is what makes turning the preference on run the check straight away.
2. The renderer calls `shell.updates.getLatest()`, and **main** makes the request (§4.2). Main reads `notifyWhenUpdateIsAvailable` itself and makes no request when it is off.
3. Main sends `GET https://api.github.com/repos/thomasjbarrett82/actuality/releases/latest` with `Accept: application/vnd.github+json` and reads `tag_name` (e.g. `v0.2.1`). This endpoint returns only published releases, never drafts or pre-releases.
4. Any failure resolves to `null`, meaning **unknown**, and is never shown to the user: a network error, a timeout, a non-2xx status, a rate limit, a body that isn't JSON or has no string `tag_name`, or a tag that isn't a plain version (§3.2). Being offline is normal.
5. The renderer derives "outdated" from the cached result and the client version. Nothing is persisted.

### 3.2 Version comparison

Pure functions in `src/shared/news/version.ts`:

- `parseVersion(s)`: strips one leading `v`; the rest must match `RELEASE_VERSION` (`^\d+\.\d+\.\d+$`, in `feed.ts`), or the version is unknown. The parts are integers `[major, minor, patch]`.
- `compareVersions(a, b)`: compares the parts numerically, in order. The first non-zero difference decides, so `0.10.0` is newer than `0.9.0`.
- `isOutdated(client, latest)`: the latest version is known and the client version is older. A development build ahead of the latest release isn't outdated.

Actuality doesn't publish pre-releases, so a tag such as `v1.0.0-beta.1` is unknown.

### 3.3 Update toast

Shown when **all** of these hold:

- `notifyWhenUpdateIsAvailable` is on.
- The check has a result, and the client version is outdated.
- `updateNotificationShownForVersion` isn't the latest version.

| Field | Value |
| --- | --- |
| id | `update-available` |
| Title | "A new version of Actuality is available" |
| Message | "Version {version} of Actuality has been released." |
| Button | **View release notes**: opens the release post `https://actualitydesktop.org/blog/release-{version}` externally. The post links the download page in its first paragraph (`scripts/release-post.ts`). The button doesn't close the toast. |
| On close | `updateNotificationShownForVersion` = the latest version |

Dismissal is stored per device and keyed to the version. The toast therefore shows at most once per version on each device, whichever budget is open, and comes back when a newer version is published. When a condition stops holding (the preference is turned off), the toast is removed.

### 3.4 No self-update

Actuality has no auto-updater, so there is no "update ready to install" toast. Users download and install new versions themselves, from the release post's link.

### 3.5 Tests and development

- **E2E:** with `ACTUAL_DESKTOP_E2E=1` (set by `tests/e2e/launch.ts`) and no override, main makes no request and resolves `null`. Ordinary E2E runs therefore make no network requests and show no update toast, which would otherwise cover the UI under test and its axe checks.
- **Override:** `ACTUAL_DESKTOP_LATEST_VERSION` (e.g. `v99.9.9`) makes main return that version without a request. A value that isn't a plain version resolves `null`.
- Main honors the override only when `app.isPackaged` is false, so it never applies to an installed copy.

## 4. News feed

### 4.1 The feed

The feed's format, its contract (`newsFeedSchema` in `src/shared/news/feed.ts`) and how it is generated from the blog are in `02` §3.1. The app validates what it downloads with the same schema the generator checks its output against, so the two can't drift apart. In short: `{ "schemaVersion": 1, "entries": [ … ] }`, strictly newest first, with unique canonical timestamps and unique ids; each entry has `id`, `type` (`release` or `post`), `title`, `date`, `url` and Markdown `body`, and a release has `version` and optionally `details`. `src/shared/news/feed.ts` also holds the site's addresses (`SITE_URL`, `NEWS_FEED_URL`, `BLOG_URL`, `RELEASE_NOTES_URL`, `releasePostUrl()`), so the generator and the app share them.

### 4.2 Requests

**Where requests run.** The renderer can't make the requests itself: the CSP (`02` §6) is `default-src 'self'`, and widening it to remote hosts would loosen the sandbox for the whole UI. So **main** makes both requests with Electron's `net.fetch` (`src/main/news.ts`) and exposes them on the shell bridge (`src/shared/shell-api.ts`, channels `shell:news:getFeed` and `shell:updates:getLatest`):

```ts
news: {
  /** The validated feed; null when it's off, can't be reached, or doesn't match the contract. */
  getFeed(): Promise<NewsFeed | null>;
};
updates: {
  /** The latest published version as X.Y.Z; null when it's off or unknown. */
  getLatest(): Promise<string | null>;
};
```

`net.fetch` uses Chromium's network stack, so it honors the system proxy. The `extraCaCertPath` setting (`02` §6) applies only to the Actual server and doesn't affect these requests.

**Feed URL** (first match wins):

1. `ACTUAL_DESKTOP_NEWS_URL`, honored only when `app.isPackaged` is false. An `http`/`https` URL is fetched; anything else is a file path (or `file:` URL) that main reads from disk. Development uses it to preview local feed changes (`website/static/news.json`), and E2E uses it to load a fixture.
2. With `ACTUAL_DESKTOP_E2E=1` and no override: no request; `null`.
3. `NEWS_FEED_URL`, `https://actualitydesktop.org/news.json`.

**Fetch rules** (both requests):

- Main reads the subsystem's preference itself, and makes **no request** when it is off. The renderer query is gated on the same preference, so the request is stopped at both ends, not just hidden in the UI.
- A plain `GET`, with no cookies or credentials (`credentials: 'omit'`), no query parameters, and no ids of the user or install. The `User-Agent` is the fixed string `Actuality`, with no version: GitHub's API requires one, and Electron's default would include the app and Electron versions.
- A 10-second timeout. A body over 1 MiB is refused, whether its `Content-Length` says so or it streams past the limit.
- A non-2xx response is an error.
- Main validates the feed with `parseNewsFeed()` before returning it: `schemaVersion` equality, required field types, canonical `date`s, strict ordering and unique ids. One malformed entry rejects the **whole** feed, because accepting part of it would make read state unpredictable.
- **Logging** (`02` §8.2): each request writes one `info` line, `news.request`, with `request` (`news.feed` or `updates.latest`), `outcome` (`ok`, `override`, `off`, `e2e`, or the reason for `null`: `network`, `timeout`, `status`, `tooLarge`, `json`, `invalid`), the HTTP `status` for a `status` failure, and the duration. It never records the feed's content or the response body.

### 4.3 Caching

The renderer keeps both results in Vue Query (`src/renderer/news/use-news.ts`):

| Query | Key | Stale time | Cache lifetime | Retries | Refetch |
| --- | --- | --- | --- | --- | --- |
| News feed | `['news', 'feed']` | 6 hours | the whole session | 1 | on window focus, once stale |
| Latest version | `['updates', 'latest']` | 24 hours | the whole session | 1 | on window focus, once stale |

Main's `null` counts as a failed fetch, so it gets the one retry and then the error state; the last good result stays in the cache meanwhile. The bell is always mounted on the main canvas and the effects (§3.3, §4.7) in `App.vue`, and the Notifications dialog reads the same query, so opening it doesn't refetch. Nothing is persisted: a fresh fetch on the next launch is fine. These queries (and `['app', 'info']`, which holds the client version) aren't host data, so `data:changed` events never invalidate them (`03` §4.1).

### 4.4 Read state

Read state is one timestamp, `lastSeenNewsAt`, per device, not a set of seen ids. Pure functions in `src/shared/news/read-state.ts`:

```text
unseen(entries, lastSeen):
    if lastSeen is null: return []                       # first run: nothing is unread
    return [e for e in entries if e.date > lastSeen]     # strict, plain string comparison

newestTimestamp(entries):
    return entries[0]?.date ?? null                      # the feed is strictly newest first

advance(lastSeen, t):                                    # never moves back
    return t if t and (lastSeen is null or t > lastSeen) else lastSeen

markAllSeen(entries, lastSeen) = advance(lastSeen, newestTimestamp(entries))
```

- **Only feed values are stored.** `lastSeenNewsAt` is always copied from an entry's `date`, never from the device clock. A wrong clock or a different time zone can't skip or repeat entries, and the stored value is already canonical, so it compares correctly with feed values.
- **It only moves forward.** It never moves back, even when a newer entry is later removed from the feed.
- **First-run baseline.** When the feed is on and loaded but `lastSeenNewsAt` is `null` (a new install, or the first version with this feature), it is set to `newestTimestamp(entries)` **without notifying**. New users then don't see a backlog of history as unread. An empty feed leaves it `null`.
- **Why a timestamp:** it has a constant size, needs no pruning as old entries drop off the feed, and means "everything up to here is read". Full timestamps, which are unique within the feed, keep two entries from the same day separate: seeing the morning post leaves the afternoon post unread, and closing a release's toast marks only that release as seen.
- The renderer writes it with `shell.settings.set('lastSeenNewsAt', …)`, and the window sees the change through `settings.onChange`.

`useNews()` (`src/renderer/news/use-news.ts`) gives the bell, the dialog and the effects `isEnabled`, `entries`, `unseenCount`, `lastSeen`, the loaded / loading / error state, `markAllSeen()` and `markSeenUpTo(date)`.

### 4.5 Bell

A control in the sidebar's bottom row (`08` §2.4), **left of the privacy mode toggle**: an `--icon` bell icon button with a `--hit-min` hit area, icon only in both the expanded and compact modes. When the sidebar's scrollbar shows, it moves into the Add Account row with the other bottom controls (`08` §1). The sidebar exists only on the main canvas, so the bell does too; elsewhere the Help menu item opens the dialog (§4.6).

| State | Rendering |
| --- | --- |
| `showNewsFeed` off | Not rendered. |
| unseen = 0, loading, or error | Bell icon, no badge. Tooltip and accessible name: "Notifications". No error is ever shown on the bell. |
| unseen = 1–9 | Bell with a pill badge showing the count. Tooltip and accessible name: "Notifications: {n} unread". |
| unseen ≥ 10 | The badge shows "9+". The accessible name has the real count. |

- **Badge:** absolutely positioned at the top right of the button, inside it so no row clips it: `--badge-h-sm` tall, a minimum width of `--badge-h-sm`, a pill radius, bold `xs` text, in `--news-badge` with `--news-badge-text` (`05` §1.8), which pass contrast on the blue background in all four palettes. It has `pointer-events: none` and `aria-hidden`; the count is in the accessible name.
- **Behavior:** click, Enter or Space opens the Notifications dialog. The bell is always enabled, offline too.
- **Fit:** the bottom row fits at `--sidebar-w-compact` at every zoom level (the sidebar is compact automatically from 150%, `22` §5); the rows wrap rather than overflow, including the Add Account row in the scrolled layout.

### 4.6 Notifications dialog

A `StandardDialog` (`17` §2) titled "Notifications", width `lg`, height 36 rem (capped by the window, like the Keyboard Shortcuts dialog, `06` §6.1), with one **Close** button.

**Opened by:**

- the bell;
- **Help ▸ Notifications…**, the item after Keyboard Shortcuts, shown only while `showNewsFeed` is on (main hides it with `visible: false`, `06` §4), and available on every screen, the start screens included;
- the "what's new" toast's button (§4.7).

When `showNewsFeed` is off, the dialog can't be opened. Only one is open at a time.

**Layout, top to bottom:**

1. A row of external links that stays in view while the list scrolls: "All release notes" (`https://actualitydesktop.org/blog/tags/release`) and "Blog" (`https://actualitydesktop.org/blog`).
2. Exactly one of:
   - **Loading:** the `AppSpinner` (`05` §5), which fades in after 400 ms so a fast load doesn't flash it, in a `status` with the visually hidden text "Loading the latest news…". The list area has `aria-busy`.
   - **Error:** "The latest news isn't available right now. Actuality couldn't reach actualitydesktop.org, which usually means you're offline. Everything else keeps working, and the news will load next time you're connected."
   - **Empty:** "Nothing new to show yet."
   - **Entries:** one card per entry, in feed order, in a list.

Changes between these states are announced politely (`22` §4.5): the error or empty text, or "{n} notifications." when the entries arrive.

**Mark as seen when opened; freeze the markers at that moment.**

- When the dialog opens, it captures the current `lastSeenNewsAt` once.
- The unread markers are computed from that **captured** value.
- As soon as entries are available, the dialog calls `markAllSeen()` (again if a refetch brings newer entries while it's open). The bell's badge clears straight away.
- Because the markers use the captured value, the cards the user came to read keep their unread dots until the dialog closes, even though the stored state now says "seen".
- Opening the dialog by any route removes the "what's new" toast (§4.7), which is now redundant.

**Entry card** (an `article` named by its title):

- **Header row** (wraps when narrow):
  - A type pill, "Release" or "Post", shown in capitals with CSS (`text-transform`, so translations keep their own case), in `--news-pill-release-bg`/`--news-pill-release-text` or `--news-pill-post-bg`/`--news-pill-post-text` (`05` §1.8). The label carries the type, so color isn't the only cue.
  - The title, as an `h3`, bold `lg`, filling the remaining space.
  - When unread: a small `--accent-blue` dot (`aria-hidden`) and the visually hidden text "Unread".
  - The publication date, in a `<time datetime>`. Feed dates are instants, not budget dates, so they are the one exception to the `YYYY-MM-DD` rule: the instant is converted to the local time zone, then formatted with `Intl.DateTimeFormat` in the app language (`dateStyle: 'medium'`, no time). The budget's date format isn't used, because no budget may be open and that format is per budget. A UTC instant late in the day can fall on the next local date, and the local date is shown.
- `body`, rendered as Markdown.
- If `details` exists: a disclosure button, "Show all changes" / "Hide all changes" (`aria-expanded`, `aria-controls`), that shows `details` (also Markdown) below the body. It starts collapsed.
- An external link, "Read on the blog", to the entry's `url`.

**Markdown rendering** (`MarkdownView`, `components/news/markdown.ts`):

- The feed is untrusted content. It is parsed with `markdown-it` (pinned exactly) with `html: false`, `linkify: false` and `typographer: false`, so leftover lowercase HTML shows as text. Its token stream becomes a node tree rendered as Vue elements, never with `v-html` (`20` §1), as `RichText` does (`17` §1).
- Supported: paragraphs, headings, emphasis, strong, strikethrough, inline code, code blocks, lists, blockquotes, horizontal rules, tables (a wide table scrolls on its own) and links.
- **Headings are demoted** under the card's `h3`: `#`/`##` → `h4`, `###` → `h5`, deeper → `h6`.
- **Links:** only absolute `http:`/`https:` targets are links. Each one opens through `shell.openExternal` (`02` §6). Any other target, `#anchor` and `mailto:` included, shows as its text.
- **Images:** the CSP doesn't allow remote images, so an image is shown as a link to its URL, labeled with its alt text (or the URL when it has none). An image whose URL isn't `http(s)` shows as its alt text.
- **Callouts:** Docusaurus admonitions (`:::tip … :::`) aren't converted by the generator or the client, and show as plain text. Posts that set `in_app_notification` don't use them (`docs/operations.md`).

### 4.7 "What's new" toast after an upgrade

The first time a user runs a version whose release is in the feed, they are told once. The effect is mounted once in `App.vue`, so it works on every screen. It runs whenever the feed entries, `lastSeenNewsAt` or the client version change:

```text
if not showNewsFeed: remove the toast; return
if entries is empty: return
if lastSeen is null:
    lastSeen = newestTimestamp(entries)     # first-run baseline (§4.4)
    return

release = the newest entry in unseen(entries, lastSeen)
          with type "release" and version <= clientVersion     # already installed
if none: remove the toast; return

show toast:
    id:      "whats-new"   (stable, so it never duplicates)
    title:   "What's new in Actuality {version}"
    message: "You're now running a new version of Actuality. Take a look at what has changed."
    button:  "See what's new" → open the Notifications dialog
    onClose: lastSeen = advance(lastSeen, release.date)     # up to this release's instant only
```

The release is chosen by `releaseToNotify()` (`src/shared/news/read-state.ts`).

- **Only releases at or below the client version.** Newer releases belong to the update check.
- **Closing advances `lastSeen` to the release's timestamp, not the newest one.** Say the user runs 0.2.1 and the feed already has 0.3.0. Closing the 0.2.1 toast must not mark 0.3.0 as seen, or its unread badge, and its own toast after the upgrade, would be lost. Timestamps are unique, so a post published after the release, even on the same day, stays unread.
- **Opening the Notifications dialog** by any route removes the toast without changing `lastSeen`. The dialog then marks everything seen.
- Turning `showNewsFeed` off removes the toast.

## 5. Toast stack

A Pinia `toasts` store (`src/renderer/stores/toasts.ts`) holds the list: `show({ id, title, message, action?, onClose? })` adds a toast or replaces the one with the same id, `remove(id)` takes one away without calling `onClose`, and `close(id)` (✕ or Esc) takes it away and calls `onClose`. A `ToastHost` (`components/common/ToastHost.vue`) is mounted once in `App.vue`, outside the screens, so toasts stay put when the canvases slide.

- **Placement:** bottom right of the window, `--space-4` from the edges, above the screens and below callouts and modal dialogs. While a modal is open, the stack is `inert`. The newest toast is on top and the oldest at the bottom, in the same order in the DOM; there are at most three in practice (§3.3, §4.7, and the Tags manager's "No tags selected to add", `04` §5.2). About 22 rem wide, capped by the window. Toasts use the callout surface (`--callout-bg-start` → `--callout-bg-end`, `--tooltip-border`) with a bold `md` title, the message, the action as a standard button (a toast that only informs has none), and a close button (✕, accessible name "Close").
- **No timers.** Every toast stays until it is closed or removed (WCAG 2.2.1).
- **Never takes focus.** When a toast appears (not when it is replaced with the same text), its title and message are announced politely through the announcer (`22` §4.5).
- **Keyboard** (`22` §2.1):
  - The stack is a `region` named "Messages" while it holds a toast. It is the last F6 region on the main canvas, and the second region on blue-canvas screens. Each toast is a `group` named by its title.
  - Tab moves between a toast's action and close buttons.
  - Esc inside a toast closes it and returns focus to where it was before it entered the stack (where F6 came from). The stack handles its own keys (`data-own-keys`), so no screen's Esc runs first.
  - Closing a toast with ✕ while focus is in the stack moves focus to the next toast's action; closing the last one returns focus to where it came from. If that element is gone, focus moves to the first region.
- **Closing** with ✕ or Esc calls the toast's `onClose`. Its action button runs the action, and closes the toast only where §3.3 or §4.7 says so.

## 6. How the two subsystems interact

With both preferences on, the user runs **C**, the newest release in the feed is **F**, and the newest **published** GitHub release is **L**.

| Situation | Update toast | "What's new" toast | Bell badge |
| --- | --- | --- | --- |
| Fresh install, C = F = L | no | no (the baseline is recorded) | 0 |
| The user just upgraded to C = F = L; F unseen | no | **yes**, for F | ≥ 1 |
| C < F = L; F unseen | **yes**, for L (until closed for L) | only if an older unseen release ≤ C exists | ≥ 1 (F counts) |
| C = L < F: the release pull request has merged, but the GitHub release is still a draft | no | no | ≥ 1 (F counts; §9) |
| A post with `in_app_notification` is published | — | — | +1 |
| `showNewsFeed` off | unaffected | never | the bell and Help item are hidden |
| `notifyWhenUpdateIsAvailable` off | never; no request | unaffected | unaffected |
| Offline | none (unknown) | none (no feed) | no badge; the dialog shows its error |

The feed can't fall behind the published releases: a release's post and feed entry merge before its GitHub release can be published (`docs/operations.md`).

## 7. Privacy, security, offline

- **Hosts contacted.** `actualitydesktop.org` for the feed, and `api.github.com` for the update check. Otherwise Actuality contacts only the user's own Actual server. The Preferences hints (§2.1) and the user guide name both hosts.
- **Opting out stops the traffic.** Turning off either preference stops that subsystem's requests in main, not just its UI.
- **No identifiers.** Requests are anonymous `GET`s of public resources: no cookies, query parameters, user ids or install ids, and a fixed `User-Agent` of `Actuality` with no version (§4.2).
- **Untrusted content.**
  - Main validates the feed's shape before it reaches the renderer (§4.2).
  - The renderer shows Markdown without raw HTML or `v-html` (§4.6).
  - Links open only through `shell.openExternal`, which allows `http:`/`https:` only (`02` §6).
  - The CSP is unchanged.
- **Offline first.** Every failure degrades quietly: the update check is unknown, so not outdated; the bell has no badge; and the dialog shows its error. Nothing delays startup, opening a budget, or the connection state.
- **Rate limits.** GitHub's unauthenticated API allows about 60 requests an hour per IP. One check per launch, plus one a day on focus, stays far below that. Neither subsystem polls.

## 8. Acceptance criteria

### 8.1 Fetching (main)

- Feed URL order: `ACTUAL_DESKTOP_NEWS_URL` (unpackaged only) → none under `ACTUAL_DESKTOP_E2E` → `NEWS_FEED_URL`.
- A well-formed feed is returned. An invalid feed (per the contract), a non-2xx status, a network error, bad JSON, a timeout or an oversized body resolves `null`.
- With a preference off, main makes no request for that subsystem, even when the renderer asks.
- Requests carry no credentials or query parameters, and send the `User-Agent` `Actuality`.

### 8.2 Read state and UI

- With `lastSeen` null, nothing is unseen, and the baseline is recorded without a toast.
- Unseen uses a strict `>` on the timestamp; two entries on the same day stay apart.
- `lastSeen` is only ever set to a value from the feed, never from the clock, and never moves back.
- The bell is hidden when the feed is off, has no badge at 0, shows N for 1–9 and "9+" for ≥ 10, has the count in its accessible name, and opens the dialog.
- The bottom sidebar row fits at the compact width, at 100–200% zoom, and in the scrolled layout.
- Help ▸ Notifications… is hidden when the feed is off, and opens the dialog from a start screen.
- The dialog shows its loading, error (offline) and empty states, renders Markdown (headings demoted, no raw HTML, images as links), shows dates converted to local time before formatting, and opens links externally. "Show all changes" toggles the details.
- Opening the dialog marks everything seen, while the unread dots reflect the state at the moment it opened.
- The "what's new" toast picks the newest unseen release ≤ the client version, and ignores posts and newer releases. Closing it sets `lastSeen` to that release's timestamp only, so a post published later the same day stays unread.
- Opening the dialog removes the "what's new" toast.
- Toasts never take focus, are announced, are reachable with F6, close with Esc, and are inert under a modal dialog.

### 8.3 Update check

- No request when it's off. Errors yield unknown, which isn't outdated, and the About status line shows nothing.
- `v` prefixes are handled, and comparison is numeric (`0.10.0 > 0.9.0`).
- A tag that isn't plain `X.Y.Z` (e.g. `v1.0.0-beta.1`) is unknown.
- The toast stays away after being closed for that exact version, and comes back for a newer one.
- Dismissal is per device: after closing it with one budget open, opening another budget doesn't show it again.
- Turning the preference on runs the check straight away. Turning it off removes the toast.
- E2E runs make no network requests unless a test sets an override.

## 9. Known limitations

1. **Release notes go live before the release.** The release pull request's merge publishes the website, so the feed entry for release F is live while F's GitHub release is still a draft, until the release checklist is done and the draft is published (`docs/operations.md`). In that window the bell counts F, and its post links a download page that doesn't list F yet. Neither toast fires: the update check sees only published releases, and the "what's new" toast needs F ≤ C. If the window grows long, two fixes would work: publish the website from the GitHub release's `published` event, or hide release entries newer than the latest published version.
2. **The feed timestamp is the post's, not the release's.** `release-post.ts` dates the post when the release workflow runs, not when the release is published. Read-state ordering follows the post.
3. **Read state isn't synced.** `lastSeenNewsAt` and `updateNotificationShownForVersion` are per device by design, so reading news or closing an update on one computer doesn't affect another. The other app preferences work the same way (`19` §1).
4. **English only.** Feed content is the blog's text, which isn't translated (`20` §3.8). The app's own strings around it go through i18n.
