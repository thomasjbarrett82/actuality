import { describe, expect, it } from 'vitest';
import { bundledFrom, resolve, shipped } from './third-party-licenses';

const LOCK = {
  'node_modules/a': { version: '1.0.0', dependencies: { b: '1', c: '1' } },
  'node_modules/b': { version: '1.0.0' },
  'node_modules/a/node_modules/c': { version: '2.0.0' },
  'node_modules/c': { version: '1.0.0', dev: true },
  'node_modules/vue': { version: '3.0.0', dev: true, dependencies: { shared: '1' } },
  'node_modules/shared': { version: '1.0.0', dev: true },
  'node_modules/tool': { version: '1.0.0', dev: true },
};

describe('third-party licenses', () => {
  it('resolves a dependency nested first, then up the tree', () => {
    expect(resolve(LOCK, 'node_modules/a', 'c')).toBe('node_modules/a/node_modules/c');
    expect(resolve(LOCK, 'node_modules/a', 'b')).toBe('node_modules/b');
    expect(resolve(LOCK, '', 'missing')).toBeNull();
  });

  it('ships production packages plus the bundled dev ones, with their dependencies', () => {
    expect(shipped(LOCK, ['vue'])).toEqual([
      'node_modules/a',
      'node_modules/a/node_modules/c',
      'node_modules/b',
      'node_modules/shared',
      'node_modules/vue',
    ]);
  });

  it('finds the dev dependencies the app source imports', () => {
    const sources = [
      "import { ref } from 'vue';\nimport x from './local';\nimport '@fontsource/inter';",
      "const m = await import('echarts/core');\nimport { t } from '@shared/x';\nimport fs from 'node:fs';",
      "import { describe } from 'vitest-not-listed';",
    ];
    expect(bundledFrom(['vue', '@fontsource/inter', 'echarts', 'tool'], sources)).toEqual([
      '@fontsource/inter',
      'echarts',
      'vue',
    ]);
  });
});
