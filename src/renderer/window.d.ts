// The preload's bridge (02 §4). The API host's MessagePort arrives separately, by window.postMessage.
import type { ShellApi } from '@shared/shell-api';

declare global {
  interface Window {
    readonly app: { readonly shell: ShellApi };
  }
}
