// Palette switching (05 §1.9): `appearance` (or the OS, with 'system') selects light or dark; `colorVision`
// adds the CVD palette. Applied as data-theme / data-cvd on <html>; changes apply live.
import type { AppSettings } from '@shared/settings';
import { onScopeDispose, ref, watchEffect } from 'vue';

export interface ThemeAttributes {
  theme: 'light' | 'dark';
  cvd: 'on' | 'off';
}

export function themeAttributes(
  appearance: AppSettings['appearance'],
  colorVision: AppSettings['colorVision'],
  systemDark: boolean,
): ThemeAttributes {
  const dark = appearance === 'dark' || (appearance === 'system' && systemDark);
  return { theme: dark ? 'dark' : 'light', cvd: colorVision === 'cvd' ? 'on' : 'off' };
}

export function applyTheme(
  attrs: ThemeAttributes,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset['theme'] = attrs.theme;
  root.dataset['cvd'] = attrs.cvd;
}

/** Keeps <html> in step with the settings and the OS color scheme. */
export function useTheme(settings: () => Pick<AppSettings, 'appearance' | 'colorVision'>): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const systemDark = ref(query.matches);
  const onChange = (e: MediaQueryListEvent): void => {
    systemDark.value = e.matches;
  };
  query.addEventListener('change', onChange);
  onScopeDispose(() => {
    query.removeEventListener('change', onChange);
  });
  watchEffect(() => {
    const s = settings();
    applyTheme(themeAttributes(s.appearance, s.colorVision, systemDark.value));
  });
}
