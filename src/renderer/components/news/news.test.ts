// Notifications in the renderer (24): the Markdown renderer, the bell, the Notifications dialog, the toast
// stack, the "what's new" and update toasts, the Preferences section and the About status line.
import type { NewsEntry, NewsFeed } from '@shared/news/feed';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@shared/settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { liveRegions, resetAnnouncer } from '../../a11y/announcer';
import { keyboard } from '../../keyboard/dispatcher';
import { openNotifications, useNotificationEffects } from '../../news/notifications';
import PreferencesScreen from '../../screens/start/PreferencesScreen.vue';
import { useModals } from '../../stores/modals';
import { useSettings } from '../../stores/settings';
import { useToasts } from '../../stores/toasts';
import { axe, mountApp } from '../../testing/mount';
import AboutDialog from '../budget-file/AboutDialog.vue';
import ToastHost from '../common/ToastHost.vue';
import NotificationsBell from '../sidebar/NotificationsBell.vue';
import { demotedHeading, parseMarkdown, webUrl } from './markdown';
import MarkdownView from './MarkdownView.vue';
import NotificationsDialog from './NotificationsDialog.vue';

const release = (version: string, date: string, extra: { details?: string } = {}): NewsEntry => ({
  id: `release-${version}`,
  type: 'release',
  title: `Actuality ${version}`,
  date,
  version,
  url: `https://actualitydesktop.org/blog/release-${version}`,
  body: `Highlights of ${version}`,
  ...extra,
});
/** The shell bridge's mocked calls (test-setup.ts). */
const openExternalCalls = () => vi.mocked(window.app.shell).openExternal.mock.calls;
const settingCalls = () => vi.mocked(window.app.shell.settings).set.mock.calls;
const post = (slug: string, date: string): NewsEntry => ({
  id: `post-${slug}`,
  type: 'post',
  title: `Post ${slug}`,
  date,
  url: `https://actualitydesktop.org/blog/${slug}`,
  body: `Body of ${slug}`,
});

let feed: NewsFeed | null;
let latest: string | null;
let queryClient: QueryClient;

/** The settings store, saved through a shell stub that keeps what it's given. */
function useSavedSettings(initial: Partial<AppSettings> = {}) {
  const settings = useSettings();
  settings.app = { ...DEFAULT_APP_SETTINGS, ...initial };
  settings.loaded = true;
  vi.mocked(window.app.shell.settings).set.mockImplementation((key, value) => {
    const next = { ...settings.app, [key]: value };
    return Promise.resolve(next);
  });
  return settings;
}

function mount<C extends Parameters<typeof mountApp>[0]>(component: C) {
  return mountApp(component, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
}

beforeEach(() => {
  resetAnnouncer();
  feed = null;
  latest = null;
  queryClient = new QueryClient();
  vi.mocked(window.app.shell.news).getFeed.mockImplementation(() => Promise.resolve(feed));
  vi.mocked(window.app.shell.updates).getLatest.mockImplementation(() => Promise.resolve(latest));
});

describe('Markdown from the feed (24 §4.6)', () => {
  it('demotes headings under the card heading', () => {
    expect([1, 2, 3, 4, 6].map(demotedHeading)).toEqual(['h4', 'h4', 'h5', 'h6', 'h6']);
    const nodes = parseMarkdown('# One\n\n## Two\n\n### Three\n\n#### Four');
    expect(nodes.map((n) => (n.type === 'element' ? n.tag : n.type))).toEqual([
      'h4',
      'h4',
      'h5',
      'h6',
    ]);
  });

  it('shows raw HTML as text, never as markup', () => {
    const w = mountApp(MarkdownView, {
      props: { source: 'Hello <script>alert(1)</script> <b>bold</b>' },
    });
    expect(w.find('script').exists()).toBe(false);
    expect(w.find('b').exists()).toBe(false);
    expect(w.text()).toContain('<script>alert(1)</script>');
  });

  it('links only http(s) targets, opening them externally, and shows images as links', async () => {
    const w = mountApp(MarkdownView, {
      props: {
        source:
          '[site](https://actualitydesktop.org) [anchor](#top) [mail](mailto:a@b.c) ![The chart](https://actualitydesktop.org/img/blog/chart.png)',
      },
    });
    const links = w.findAll('a');
    expect(links.map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['site', 'https://actualitydesktop.org/'],
      ['The chart', 'https://actualitydesktop.org/img/blog/chart.png'],
    ]);
    expect(w.text()).toContain('anchor');
    expect(w.text()).toContain('mail');
    expect(w.find('img').exists()).toBe(false);
    await links[0]?.trigger('click');
    expect(openExternalCalls()).toContainEqual(['https://actualitydesktop.org/']);
    expect(webUrl('javascript:alert(1)')).toBeNull();
  });

  it('renders lists, emphasis, code, quotes, rules and tables', () => {
    const w = mountApp(MarkdownView, {
      props: {
        source: [
          '- **strong** and *em* and `code`',
          '- two',
          '',
          '1. first',
          '',
          '> quoted',
          '',
          '---',
          '',
          '```ts',
          'const x = 1;',
          '```',
          '',
          '| A | B |',
          '| :-- | --: |',
          '| 1 | 2 |',
        ].join('\n'),
      },
    });
    expect(w.findAll('ul > li')).toHaveLength(2);
    expect(w.find('ul > li > p').exists()).toBe(false); // tight list
    expect(w.find('strong').text()).toBe('strong');
    expect(w.find('em').text()).toBe('em');
    expect(w.find('li code').text()).toBe('code');
    expect(w.find('ol > li').text()).toBe('first');
    expect(w.find('blockquote').text()).toBe('quoted');
    expect(w.find('hr').exists()).toBe(true);
    expect(w.find('pre code').text()).toBe('const x = 1;');
    expect(w.findAll('th').map((th) => th.attributes('style'))).toEqual([
      'text-align: left;',
      'text-align: right;',
    ]);
  });
});

describe('the bell (24 §4.5)', () => {
  const entries = Array.from({ length: 12 }, (_, i) =>
    post(`p${i}`, `2026-11-${String(20 - i).padStart(2, '0')}T12:00:00Z`),
  );

  it('is hidden while the news feed is off', async () => {
    useSavedSettings({ showNewsFeed: false });
    feed = { schemaVersion: 1, entries };
    const w = mount(NotificationsBell);
    await flushPromises();
    expect(w.find('button').exists()).toBe(false);
    expect(vi.mocked(window.app.shell.news).getFeed.mock.calls).toHaveLength(0);
  });

  it('has no badge with nothing unread, or offline', async () => {
    useSavedSettings({ lastSeenNewsAt: entries[0]?.date ?? null });
    feed = { schemaVersion: 1, entries };
    const w = mount(NotificationsBell);
    await flushPromises();
    expect(w.find('.bell__badge').exists()).toBe(false);
    expect(w.find('button').attributes('aria-label')).toBe('Notifications');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('counts the unread entries, showing 9+ from 10 with the real count in its name', async () => {
    const settings = useSavedSettings({ lastSeenNewsAt: entries[3]?.date ?? null });
    feed = { schemaVersion: 1, entries };
    const w = mount(NotificationsBell);
    await flushPromises();
    expect(w.find('.bell__badge').text()).toBe('3');
    expect(w.find('.bell__badge').attributes('aria-hidden')).toBe('true');
    expect(w.find('button').attributes('aria-label')).toBe('Notifications: 3 unread');

    settings.app = { ...settings.app, lastSeenNewsAt: '2026-01-01T00:00:00Z' };
    await nextTick();
    expect(w.find('.bell__badge').text()).toBe('9+');
    expect(w.find('button').attributes('aria-label')).toBe('Notifications: 12 unread');
  });

  it('opens the Notifications dialog', async () => {
    useSavedSettings();
    const w = mount(NotificationsBell);
    await flushPromises();
    await w.find('button').trigger('click');
    expect(useModals().stack.map((m) => m.component)).toEqual([NotificationsDialog]);
  });
});

describe('the Notifications dialog (24 §4.6)', () => {
  const r021 = release('0.2.1', '2026-11-08T20:13:29Z', {
    details: '## Features\n\n- Everything',
  });
  const late = post('late', '2026-11-08T23:30:00Z');
  const older = post('older', '2026-10-01T12:00:00Z');

  it('shows the entries, marks everything seen, and keeps the unread dots of the moment it opened', async () => {
    const settings = useSavedSettings({ lastSeenNewsAt: older.date });
    feed = { schemaVersion: 1, entries: [late, r021, older] };
    const w = mount(NotificationsDialog);
    await flushPromises();
    expect(w.findAll('article h3').map((h3) => h3.text())).toEqual([
      'Post late',
      'Actuality 0.2.1',
      'Post older',
    ]);
    expect(settings.app.lastSeenNewsAt).toBe(late.date);
    expect(w.findAll('article').map((a) => a.find('.entry__unread').exists())).toEqual([
      true,
      true,
      false,
    ]);
    expect(w.findAll('.entry__pill').map((p) => p.text())).toEqual(['Post', 'Release', 'Post']);
    expect(liveRegions.polite).toBe('3 notifications.');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('formats each date in the local time zone, in the app language', async () => {
    useSavedSettings({ lastSeenNewsAt: older.date });
    feed = { schemaVersion: 1, entries: [late] };
    const w = mount(NotificationsDialog);
    await flushPromises();
    const local = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
      new Date(late.date),
    );
    expect(w.find('time').text()).toBe(local);
    expect(w.find('time').attributes('datetime')).toBe(late.date);
  });

  it('shows the full list of changes on demand', async () => {
    useSavedSettings({ lastSeenNewsAt: older.date });
    feed = { schemaVersion: 1, entries: [r021] };
    const w = mount(NotificationsDialog);
    await flushPromises();
    const toggle = w.find('.entry__toggle');
    const details = w.find('.entry__details');
    expect(toggle.text()).toBe('Show all changes');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBe(details.attributes('id'));
    expect(details.attributes('hidden')).toBeDefined();
    await toggle.trigger('click');
    expect(toggle.text()).toBe('Hide all changes');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    expect(details.attributes('hidden')).toBeUndefined();
    expect(details.find('h4').text()).toBe('Features');
  });

  it('opens its links externally', async () => {
    useSavedSettings();
    feed = { schemaVersion: 1, entries: [late] };
    const w = mount(NotificationsDialog);
    await flushPromises();
    const hrefs = w.findAll('a').map((a) => [a.text(), a.attributes('href')]);
    expect(hrefs).toContainEqual([
      'All release notes',
      'https://actualitydesktop.org/blog/tags/release',
    ]);
    expect(hrefs).toContainEqual(['Blog', 'https://actualitydesktop.org/blog']);
    expect(hrefs).toContainEqual(['Read on the blog', late.url]);
    await w
      .findAll('a')
      .find((a) => a.text() === 'Read on the blog')
      ?.trigger('click');
    expect(openExternalCalls()).toContainEqual([late.url]);
  });

  it('shows the empty and offline states', async () => {
    useSavedSettings();
    feed = { schemaVersion: 1, entries: [] };
    const empty = mount(NotificationsDialog);
    await flushPromises();
    expect(empty.text()).toContain('Nothing new to show yet.');
    empty.unmount();

    queryClient = new QueryClient();
    feed = null;
    const offline = mount(NotificationsDialog);
    await flushPromises();
    expect(offline.find('[aria-busy="true"]').exists()).toBe(true);
    expect(offline.find('[role="status"]').text()).toBe('Loading the latest news…');
    // Main resolved null: one retry, then the error card.
    await vi.waitFor(
      () => {
        expect(offline.text()).toContain("The latest news isn't available right now.");
      },
      { timeout: 4000 },
    );
    expect(offline.find('[aria-busy="true"]').exists()).toBe(false);
  });
});

describe('the toast stack (24 §5)', () => {
  const toast = (id: string, extra: object = {}) => ({
    id,
    title: `Title ${id}`,
    message: `Message ${id}.`,
    action: { label: `Act ${id}`, run: vi.fn() },
    onClose: vi.fn(),
    ...extra,
  });

  it('replaces a toast with the same id, and announces a new one without taking focus', async () => {
    const toasts = useToasts();
    const w = mountApp(ToastHost);
    const before = document.activeElement;
    toasts.show(toast('a'));
    toasts.show(toast('a'));
    await nextTick();
    await Promise.resolve();
    expect(w.findAll('[data-toast]')).toHaveLength(1);
    expect(liveRegions.polite).toBe('Title a Message a.');
    expect(document.activeElement).toBe(before);
    expect(w.find('section').attributes('aria-label')).toBe('Messages');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('stacks the oldest at the bottom, runs actions, and closes with ✕ (onClose) or removes (no onClose)', async () => {
    const toasts = useToasts();
    const a = toast('a');
    const b = toast('b');
    const w = mountApp(ToastHost);
    toasts.show(a);
    toasts.show(b);
    await nextTick();
    expect(w.findAll('.toast__title').map((t) => t.text())).toEqual(['Title b', 'Title a']);
    await w
      .findAll('button')
      .find((x) => x.text() === 'Act a')
      ?.trigger('click');
    expect(a.action.run).toHaveBeenCalled();
    expect(toasts.list).toHaveLength(2);
    toasts.remove('b');
    expect(b.onClose).not.toHaveBeenCalled();
    await nextTick();
    await w.find('[aria-label="Close"]').trigger('click');
    expect(a.onClose).toHaveBeenCalled();
    expect(toasts.list).toHaveLength(0);
  });

  it('is the last F6 region; Esc closes a toast and returns focus to where F6 came from', async () => {
    const toasts = useToasts();
    const panel = document.createElement('div');
    const field = document.createElement('input');
    panel.append(field);
    document.body.append(panel);
    const unregister = keyboard.registerRegion('panel', 50, panel);
    const a = toast('a');
    mountApp(ToastHost);
    toasts.show(a);
    await nextTick();
    await nextTick();
    field.focus();
    keyboard.cycleRegion(1);
    const focused = document.activeElement as HTMLElement;
    expect(focused.closest('[data-toast]')).not.toBeNull();
    focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(a.onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
    unregister();
  });

  it('is inert while a modal dialog is open', async () => {
    const toasts = useToasts();
    const w = mountApp(ToastHost);
    toasts.show(toast('a'));
    await nextTick();
    expect(w.find('section').attributes('inert')).toBeUndefined();
    const pop = keyboard.push(() => false, { modal: true });
    await nextTick();
    expect(w.find('section').attributes('inert')).toBeDefined();
    pop();
    await nextTick();
    expect(w.find('section').attributes('inert')).toBeUndefined();
  });

  it('shows a toast with no action with only its close button', async () => {
    const toasts = useToasts();
    const w = mountApp(ToastHost);
    toasts.show({ id: 'info', title: 'Title', message: 'Message.' });
    await nextTick();
    expect(w.find('.toast__actions').exists()).toBe(false);
    expect(w.findAll('[data-toast] button').map((b) => b.attributes('aria-label'))).toEqual([
      'Close',
    ]);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

/** Mounts the App.vue effects and the toast stack. */
function mountEffects() {
  const Host = defineComponent({
    setup() {
      useNotificationEffects();
      return () => h(ToastHost);
    },
  });
  return mount(Host);
}

describe('the "what\'s new" toast (24 §4.7)', () => {
  const r020 = release('0.2.0', '2026-10-01T12:00:00Z');
  // The stub's AppInfo runs 0.1.0; these tests use releases at or below and above it.
  const r010 = release('0.1.0', '2026-11-08T20:13:29Z');
  const later = post('later', '2026-11-08T21:00:00Z');
  const toastTitles = () => useToasts().list.map((t) => t.title);

  it('records the first-run baseline without a toast', async () => {
    const settings = useSavedSettings();
    feed = { schemaVersion: 1, entries: [later, r010] };
    mountEffects();
    await flushPromises();
    expect(settings.app.lastSeenNewsAt).toBe(later.date);
    expect(useToasts().list).toEqual([]);
  });

  it('announces the newest unseen release at or below the running version, and ignores newer ones', async () => {
    useSavedSettings({ lastSeenNewsAt: '2026-09-01T00:00:00Z' });
    feed = { schemaVersion: 1, entries: [r020, later, r010] };
    mountEffects();
    await flushPromises();
    expect(toastTitles()).toEqual(["What's new in Actuality 0.1.0"]);
  });

  it('closing it marks only that release as seen, so a post later that day stays unread', async () => {
    const settings = useSavedSettings({ lastSeenNewsAt: '2026-09-01T00:00:00Z' });
    feed = { schemaVersion: 1, entries: [later, r010] };
    const w = mountEffects();
    await flushPromises();
    await w.find('[aria-label="Close"]').trigger('click');
    await flushPromises();
    expect(settings.app.lastSeenNewsAt).toBe(r010.date);
    expect(useToasts().list).toEqual([]);
  });

  it('is removed by opening the dialog, which then marks everything seen', async () => {
    const settings = useSavedSettings({ lastSeenNewsAt: '2026-09-01T00:00:00Z' });
    feed = { schemaVersion: 1, entries: [later, r010] };
    const w = mountEffects();
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === "See what's new")
      ?.trigger('click');
    expect(useToasts().list).toEqual([]);
    expect(settings.app.lastSeenNewsAt).toBe('2026-09-01T00:00:00Z');
    expect(useModals().stack.map((m) => m.component)).toEqual([NotificationsDialog]);
  });

  it('is removed when the news feed is turned off, and the dialog cannot open', async () => {
    const settings = useSavedSettings({ lastSeenNewsAt: '2026-09-01T00:00:00Z' });
    feed = { schemaVersion: 1, entries: [r010] };
    mountEffects();
    await flushPromises();
    expect(useToasts().list).toHaveLength(1);
    settings.app = { ...settings.app, showNewsFeed: false };
    await flushPromises();
    expect(useToasts().list).toEqual([]);
    await openNotifications();
    expect(useModals().stack).toEqual([]);
  });
});

describe('the update toast (24 §3.3)', () => {
  it('shows once per version, opens the release post, and comes back for a newer one', async () => {
    const settings = useSavedSettings();
    latest = '0.3.0';
    const w = mountEffects();
    await flushPromises();
    expect(useToasts().list.map((t) => [t.title, t.message])).toEqual([
      ['A new version of Actuality is available', 'Version 0.3.0 of Actuality has been released.'],
    ]);
    await w
      .findAll('button')
      .find((b) => b.text() === 'View release notes')
      ?.trigger('click');
    expect(openExternalCalls()).toContainEqual(['https://actualitydesktop.org/blog/release-0.3.0']);
    expect(useToasts().list).toHaveLength(1);
    await w.find('[aria-label="Close"]').trigger('click');
    await flushPromises();
    expect(settings.app.updateNotificationShownForVersion).toBe('0.3.0');
    expect(useToasts().list).toEqual([]);

    latest = '0.4.0';
    await queryClient.refetchQueries({ queryKey: ['updates', 'latest'] });
    await flushPromises();
    expect(useToasts().list.map((t) => t.message)).toEqual([
      'Version 0.4.0 of Actuality has been released.',
    ]);
  });

  it('stays away after being closed for that version, on this device', async () => {
    useSavedSettings({ updateNotificationShownForVersion: '0.3.0' });
    latest = '0.3.0';
    mountEffects();
    await flushPromises();
    expect(useToasts().list).toEqual([]);
  });

  it('never shows while up to date, unknown or off; turning it off removes it', async () => {
    const settings = useSavedSettings();
    latest = '0.1.0';
    mountEffects();
    await flushPromises();
    expect(useToasts().list).toEqual([]);

    queryClient.setQueryData(['updates', 'latest'], '0.3.0');
    await flushPromises();
    expect(useToasts().list).toHaveLength(1);
    settings.app = { ...settings.app, notifyWhenUpdateIsAvailable: false };
    await flushPromises();
    expect(useToasts().list).toEqual([]);
  });
});

describe('Preferences ▸ Updates and News (24 §2.1)', () => {
  it('shows both checkboxes with their hints, before Diagnostics, and saves them', async () => {
    useSavedSettings();
    const w = mount(PreferencesScreen);
    await flushPromises();
    const headings = w.findAll('h2').map((h2) => h2.text());
    expect(headings.slice(-3)).toEqual(['File Associations', 'Updates and News', 'Diagnostics']);
    const updates = w.find('input[aria-describedby="prefs-updates-hint"]');
    const news = w.find('input[aria-describedby="prefs-news-hint"]');
    expect((updates.element as HTMLInputElement).checked).toBe(true);
    expect(w.find('#prefs-updates-hint').text()).toContain('api.github.com');
    expect(w.find('#prefs-news-hint').text()).toContain('actualitydesktop.org');
    await news.setValue(false);
    expect(settingCalls()).toContainEqual(['showNewsFeed', false]);
    await updates.setValue(false);
    expect(settingCalls()).toContainEqual(['notifyWhenUpdateIsAvailable', false]);
  });
});

describe('About ▸ update status (24 §2.2)', () => {
  it('links a newer version to its release post', async () => {
    useSavedSettings();
    latest = '0.3.0';
    const w = mount(AboutDialog);
    await flushPromises();
    const link = w.find('[data-update-status] a');
    expect(link.text()).toBe('New version available: 0.3.0');
    expect(link.attributes('href')).toBe('https://actualitydesktop.org/blog/release-0.3.0');
    expect(
      w
        .findAll('a')
        .find((a) => a.text() === 'Release notes')
        ?.attributes('href'),
    ).toBe('https://actualitydesktop.org/blog/tags/release');
  });

  it("says you're up to date, and nothing when unknown or off", async () => {
    const settings = useSavedSettings();
    latest = '0.1.0';
    const w = mount(AboutDialog);
    await flushPromises();
    expect(w.find('[data-update-status]').text()).toBe("You're up to date!");
    settings.app = { ...settings.app, notifyWhenUpdateIsAvailable: false };
    await nextTick();
    expect(w.find('[data-update-status]').exists()).toBe(false);
    w.unmount();

    queryClient = new QueryClient();
    useSavedSettings();
    latest = null;
    const unknown = mount(AboutDialog);
    await vi.waitFor(
      () => {
        expect(queryClient.getQueryState(['updates', 'latest'])?.status).toBe('error');
      },
      { timeout: 4000 },
    );
    await flushPromises();
    expect(unknown.find('[data-update-status]').exists()).toBe(false);
  });
});
