// The global v-tooltip and v-scroll-focus directives (main.ts), typed for templates, `data-*` attributes
// on native elements (hooks for drop targets and focus targets), and `aria-description`, which Vue's
// types lack. The imports make this a module, so the declaration augments Vue's types instead of
// replacing them.
import type { vScrollFocus } from './components/common/scroll-focus';
import type { vTooltip } from './components/common/tooltip';

declare module 'vue' {
  interface GlobalDirectives {
    vTooltip: typeof vTooltip;
    vScrollFocus: typeof vScrollFocus;
  }
  interface HTMLAttributes {
    [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
    'aria-description'?: string | undefined;
  }
}
