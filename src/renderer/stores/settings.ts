// `useSettings()` (19): the app preferences, read from and written to main through shell.settings, kept
// current by change notifications.
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type RendererWritableAppKey,
} from '@shared/settings';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSettings = defineStore('settings', () => {
  const app = ref<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const loaded = ref(false);
  let unsubscribe: (() => void) | null = null;

  async function load(): Promise<void> {
    app.value = await window.app.shell.settings.get();
    loaded.value = true;
    unsubscribe ??= window.app.shell.settings.onChange((change) => {
      if (change.scope === 'app') app.value = change.settings;
    });
  }

  async function set<K extends RendererWritableAppKey>(
    key: K,
    value: AppSettings[K],
  ): Promise<void> {
    app.value = await window.app.shell.settings.set(key, value);
  }

  return { app, loaded, load, set };
});
