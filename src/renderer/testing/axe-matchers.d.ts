// The vitest-axe matcher on Vitest's `expect` (test-setup.ts registers it).
import type { AxeMatchers } from 'vitest-axe';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any -- the declaration merges the matcher into Vitest's own generic interface
  interface Matchers<T = any> extends AxeMatchers {}
}
