import type { AppSettings } from '@shared/settings';
import { afterEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, reactive } from 'vue';
import { applyTheme, themeAttributes, useTheme } from './theme';

/** A `prefers-color-scheme: dark` query whose answer the test changes. */
function fakeColorScheme(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
  };
  const original = window.matchMedia.bind(window);
  window.matchMedia = () => query as unknown as MediaQueryList;
  return {
    set(next: boolean) {
      query.matches = next;
      for (const l of listeners) l({ matches: next } as MediaQueryListEvent);
    },
    listeners,
    restore() {
      window.matchMedia = original;
    },
  };
}

const html = () => document.documentElement.dataset;

describe('palette switching (05 §1.9)', () => {
  let scheme: ReturnType<typeof fakeColorScheme> | null = null;

  afterEach(() => {
    scheme?.restore();
    scheme = null;
  });

  it('maps appearance, color vision and the OS scheme to the four palettes', () => {
    expect(themeAttributes('light', 'standard', true)).toEqual({ theme: 'light', cvd: 'off' });
    expect(themeAttributes('dark', 'standard', false)).toEqual({ theme: 'dark', cvd: 'off' });
    expect(themeAttributes('light', 'cvd', false)).toEqual({ theme: 'light', cvd: 'on' });
    expect(themeAttributes('dark', 'cvd', false)).toEqual({ theme: 'dark', cvd: 'on' });
    expect(themeAttributes('system', 'standard', true)).toEqual({ theme: 'dark', cvd: 'off' });
    expect(themeAttributes('system', 'cvd', false)).toEqual({ theme: 'light', cvd: 'on' });
  });

  it('sets data-theme and data-cvd on the root element', () => {
    const root = document.createElement('div');
    applyTheme({ theme: 'dark', cvd: 'on' }, root);
    expect(root.dataset).toMatchObject({ theme: 'dark', cvd: 'on' });
  });

  it('switches live with the settings and the OS color scheme, and stops listening on dispose', async () => {
    scheme = fakeColorScheme(false);
    const settings = reactive<Pick<AppSettings, 'appearance' | 'colorVision'>>({
      appearance: 'system',
      colorVision: 'standard',
    });
    const scope = effectScope();
    scope.run(() => {
      useTheme(() => settings);
    });
    expect(html()).toMatchObject({ theme: 'light', cvd: 'off' });

    scheme.set(true);
    await nextTick();
    expect(html()).toMatchObject({ theme: 'dark', cvd: 'off' });

    settings.colorVision = 'cvd';
    await nextTick();
    expect(html()).toMatchObject({ theme: 'dark', cvd: 'on' });

    settings.appearance = 'light';
    await nextTick();
    expect(html()).toMatchObject({ theme: 'light', cvd: 'on' });

    scope.stop();
    expect(scheme.listeners.size).toBe(0);
  });
});
