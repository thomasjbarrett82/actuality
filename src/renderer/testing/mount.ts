// Component test helpers: mount with the app's plugins, and an axe run configured for happy-dom.
import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import { getActivePinia } from 'pinia';
import { configureAxe } from 'vitest-axe';
import type { Component } from 'vue';
import { vScrollFocus } from '../components/common/scroll-focus';
import { vTooltip } from '../components/common/tooltip';
import { i18n } from '../i18n';

/**
 * Mounts into the document (focus and Teleport need it) with Pinia, i18n, v-tooltip, v-scroll-focus and
 * extra plugins.
 */
export function mountApp<C extends Component>(
  component: C,
  options: ComponentMountingOptions<C> = {},
) {
  const host = document.createElement('div');
  document.body.append(host);
  const pinia = getActivePinia();
  return mount(component, {
    attachTo: host,
    ...options,
    global: {
      ...options.global,
      plugins: [...(pinia ? [pinia] : []), i18n, ...(options.global?.plugins ?? [])],
      directives: {
        tooltip: vTooltip,
        'scroll-focus': vScrollFocus,
        ...options.global?.directives,
      },
    },
  });
}

/**
 * axe-core over the rendered DOM. Color contrast is checked by the theme-token test instead (happy-dom
 * has no layout or computed colors), and a lone component isn't expected to sit inside a landmark.
 */
export const axe = configureAxe({
  rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
});
