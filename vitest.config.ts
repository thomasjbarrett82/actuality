import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit and component tests (21 §1). Renderer tests run in happy-dom; everything else in Node.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: [
            'src/{shared,host,main}/**/*.test.ts',
            'scripts/**/*.test.ts',
            'eslint-rules/**/*.test.ts',
            'tests/unit/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.ts'],
          environment: 'happy-dom',
          setupFiles: ['src/renderer/test-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/host/services/**/*.ts', 'src/renderer/**/*.ts'],
      // The renderer's composition root, router and test helpers are covered end to end, not here.
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'src/shared/i18n/**',
        'src/shared/domain/types.ts',
        'src/renderer/main.ts',
        'src/renderer/router.ts',
        'src/renderer/test-setup.ts',
        'src/renderer/testing/**',
      ],
      thresholds: {
        'src/shared/**/*.ts': { lines: 95 },
        'src/host/services/**/*.ts': { lines: 85 },
        'src/renderer/**/*.ts': { lines: 85 },
      },
    },
  },
});
