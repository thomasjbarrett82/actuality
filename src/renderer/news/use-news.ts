// The news feed and update check in the renderer (24 §3–4): two Vue Query queries over the shell bridge,
// each enabled only while its preference is on (main checks the preference too, 24 §4.2). Nothing is
// persisted; the next launch fetches again. They aren't host data, so `data:changed` never touches them.
import type { NewsEntry, NewsFeed } from '@shared/news/feed';
import { advance, markAllSeen as allSeen, unseen } from '@shared/news/read-state';
import { isOutdated } from '@shared/news/version';
import { useQuery } from '@tanstack/vue-query';
import { computed, type ComputedRef } from 'vue';
import { useSettings } from '../stores/settings';

const HOUR_MS = 60 * 60 * 1000;
/** The feed refetches on window focus once it is 6 hours old, the latest version once a day (24 §4.3). */
export const NEWS_STALE_MS = 6 * HOUR_MS;
export const LATEST_STALE_MS = 24 * HOUR_MS;

export const NEWS_FEED_KEY = ['news', 'feed'] as const;
export const LATEST_VERSION_KEY = ['updates', 'latest'] as const;
const APP_INFO_KEY = ['app', 'info'] as const;

/** Main resolves null for every failure; as an error it gets the one retry and the dialog's error card. */
class Unavailable extends Error {}

export interface News {
  isEnabled: ComputedRef<boolean>;
  /** Newest first; empty while off, loading or failed. */
  entries: ComputedRef<NewsEntry[]>;
  unseenCount: ComputedRef<number>;
  lastSeen: ComputedRef<string | null>;
  /** Whether the feed has loaded at least once this session. */
  isLoaded: ComputedRef<boolean>;
  isLoading: ComputedRef<boolean>;
  isError: ComputedRef<boolean>;
  /** Moves the read state to the newest entry (24 §4.4). */
  markAllSeen(): Promise<void>;
  /** Moves the read state to `date`, never back. */
  markSeenUpTo(date: string): Promise<void>;
}

export function useNews(): News {
  const settings = useSettings();
  const isEnabled = computed(() => settings.loaded && settings.app.showNewsFeed);
  const query = useQuery({
    queryKey: NEWS_FEED_KEY,
    queryFn: async (): Promise<NewsFeed> => {
      const feed = await window.app.shell.news.getFeed();
      if (!feed) throw new Unavailable();
      return feed;
    },
    enabled: isEnabled,
    staleTime: NEWS_STALE_MS,
    gcTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  const entries = computed(() => (isEnabled.value ? (query.data.value?.entries ?? []) : []));
  const lastSeen = computed(() => settings.app.lastSeenNewsAt);

  async function save(next: string | null): Promise<void> {
    if (next !== settings.app.lastSeenNewsAt) await settings.set('lastSeenNewsAt', next);
  }

  return {
    isEnabled,
    entries,
    unseenCount: computed(() => unseen(entries.value, lastSeen.value).length),
    lastSeen,
    isLoaded: computed(() => isEnabled.value && query.data.value !== undefined),
    isLoading: computed(
      () => isEnabled.value && query.data.value === undefined && !query.isError.value,
    ),
    isError: computed(
      () => isEnabled.value && query.data.value === undefined && query.isError.value,
    ),
    markAllSeen: () => save(allSeen(entries.value, settings.app.lastSeenNewsAt)),
    markSeenUpTo: (date) => save(advance(settings.app.lastSeenNewsAt, date)),
  };
}

export type UpdateStatus = 'off' | 'checking' | 'unknown' | 'outdated' | 'upToDate';

export interface Updates {
  isEnabled: ComputedRef<boolean>;
  /** The latest published version, `X.Y.Z`; null while off, checking or unknown. */
  latest: ComputedRef<string | null>;
  /** The running version (`AppInfo.version`). */
  clientVersion: ComputedRef<string | null>;
  status: ComputedRef<UpdateStatus>;
}

/** The running version, from `shell.appInfo()`: it never changes during a session. */
export function useClientVersion(): ComputedRef<string | null> {
  const info = useQuery({
    queryKey: APP_INFO_KEY,
    queryFn: () => window.app.shell.appInfo(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return computed(() => info.data.value?.version ?? null);
}

export function useUpdateStatus(): Updates {
  const settings = useSettings();
  const isEnabled = computed(() => settings.loaded && settings.app.notifyWhenUpdateIsAvailable);
  const query = useQuery({
    queryKey: LATEST_VERSION_KEY,
    queryFn: async (): Promise<string> => {
      const latest = await window.app.shell.updates.getLatest();
      if (latest === null) throw new Unavailable();
      return latest;
    },
    enabled: isEnabled,
    staleTime: LATEST_STALE_MS,
    gcTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  const clientVersion = useClientVersion();
  const latest = computed(() => (isEnabled.value ? (query.data.value ?? null) : null));
  const status = computed<UpdateStatus>(() => {
    if (!isEnabled.value) return 'off';
    const client = clientVersion.value;
    if (latest.value === null || client === null)
      return query.isError.value ? 'unknown' : 'checking';
    return isOutdated(client, latest.value) ? 'outdated' : 'upToDate';
  });
  return { isEnabled, latest, clientVersion, status };
}
