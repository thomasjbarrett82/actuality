import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const alias = { '@shared': resolve(root, 'src/shared') };

/** The About dialog's build facts (18 §1): the git commit, and the pinned @actual-app/api version. */
function buildFacts(): Record<string, string> {
  let sha = '';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout: About shows the version alone.
  }
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  return {
    'import.meta.env.APP_GIT_SHA': JSON.stringify(sha),
    'import.meta.env.APP_ACTUAL_API_VERSION': JSON.stringify(pkg.dependencies['@actual-app/api']),
  };
}

export default defineConfig({
  // Main and the API host share one build: two Node entries, ESM output.
  // The host lands at out/host/index.js and is launched with utilityProcess.fork() (02 §5).
  // @actual-app/api and better-sqlite3 stay external (externalizeDeps), so the native
  // addon resolves from node_modules at run time.
  main: {
    resolve: { alias },
    define: buildFacts(),
    build: {
      outDir: 'out',
      emptyOutDir: true,
      rolldownOptions: {
        input: {
          'main/index': resolve(root, 'src/main/index.ts'),
          'host/index': resolve(root, 'src/host/index.ts'),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
  },
  // Sandboxed renderers only run CommonJS preload scripts.
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rolldownOptions: {
        input: {
          index: resolve(root, 'src/preload/index.ts'),
          'print-preview': resolve(root, 'src/preload/print-preview.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [vue()],
    build: {
      outDir: 'out/renderer',
      rolldownOptions: { input: { index: resolve(root, 'src/renderer/index.html') } },
    },
  },
});
