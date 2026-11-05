// ESLint flat config (21 §4.1). Run with --max-warnings 0, so warnings fail like errors.
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import vueI18n from '@intlify/eslint-plugin-vue-i18n';
import vitest from '@vitest/eslint-plugin';
import type { ESLint } from 'eslint';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import importX from 'eslint-plugin-import-x';
import jsonc from 'eslint-plugin-jsonc';
import playwright from 'eslint-plugin-playwright';
import vue from 'eslint-plugin-vue';
import vueA11y from 'eslint-plugin-vuejs-accessibility';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { localPlugin } from './eslint-rules/index';

const tsFiles = ['**/*.ts', '**/*.mts', '**/*.vue'];

const actualApiImport = {
  name: '@actual-app/api',
  message: 'Only src/host/actual.ts may load @actual-app/api.',
};
// Logging is an aspect (02 §8.5): only the aspects, the sinks and the error boundaries reach a logger.
const loggerImport = {
  regex: '(^|/)log$',
  message: 'Logging is woven in as an aspect (02 §8): put it in an aspects/ folder.',
};

// The plugin's published types don't satisfy ESLint's Plugin type under exactOptionalPropertyTypes.
const i18nPlugin = vueI18n as unknown as ESLint.Plugin;

export default defineConfig(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'node_modules/**',
      'references/**',
      'docs/**',
      // The user guide site has its own toolchain: its typecheck and build (website/package.json).
      'website/**',
      'src/shared/i18n/en-XA/**',
      '**/*.d.ts',
    ],
  },

  // TypeScript everywhere, type-aware (projectService).
  { files: tsFiles, ...js.configs.recommended },
  ...tseslint.configs.strictTypeChecked.map((c) => ({ ...c, files: tsFiles })),
  ...vue.configs['flat/recommended'],
  ...vueA11y.configs['flat/recommended'],
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser,
      },
      globals: { ...globals.node },
    },
    plugins: { local: localPlugin, 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        (await import('eslint-import-resolver-typescript')).createTypeScriptImportResolver({
          project: ['tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.preload.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'import-x/no-cycle': 'error',
      'no-console': 'error',
      'no-restricted-imports': ['error', { paths: [actualApiImport], patterns: [loggerImport] }],
      'local/actual-api-import': 'error',
      'local/no-float-money': 'error',
    },
  },
  {
    files: ['src/host/actual.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [loggerImport] }] },
  },
  {
    // The aspects, the error boundaries (each process's composition root) and the tests.
    files: [
      'src/*/aspects/**/*.ts',
      'src/host/index.ts',
      'src/main/index.ts',
      'src/renderer/main.ts',
      'src/**/*.test.ts',
    ],
    rules: { 'no-restricted-imports': ['error', { paths: [actualApiImport] }] },
  },
  {
    files: ['src/shared/money.ts'],
    rules: { 'local/no-float-money': 'off' },
  },
  {
    files: [
      'src/host/log.ts',
      'src/main/log.ts',
      'scripts/**/*.ts',
      'tests/fixtures/build-fixture.ts',
      'tests/fixtures/build-demo.ts',
      'tests/e2e/server-fixture.ts',
    ],
    rules: { 'no-console': 'off' },
  },

  // Renderer: browser globals and Vue rules.
  {
    files: ['src/renderer/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.vue'],
    rules: {
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/no-v-html': 'error',
      'vue/multi-word-component-names': 'off',
      // Type-based props: an optional prop is already `T | undefined`, and an explicit `undefined` default
      // fails exactOptionalPropertyTypes.
      'vue/require-default-prop': 'off',
      // A label that wraps its control is associated; it doesn't also need for/id.
      'vuejs-accessibility/label-has-for': ['error', { required: { some: ['nesting', 'id'] } }],
    },
  },

  // Every user-visible string goes through i18n (20 §1).
  // Only the plugin's rules: its recommended config also sets a YAML parser that would replace the TS parser.
  // Missing and unused keys are checked by `npm run i18n:check` instead: the plugin can't map our
  // one-file-per-bundle layout (en/app.json holds the `app.*` keys).
  {
    files: ['src/renderer/**/*.{ts,vue}'],
    plugins: { '@intlify/vue-i18n': i18nPlugin },
    settings: { 'vue-i18n': { messageSyntaxVersion: '^11.0.0' } },
    rules: {
      ...(Object.assign(
        {},
        ...vueI18n.configs['flat/recommended'].map((c) => c.rules ?? {}),
      ) as Record<string, string>),
      '@intlify/vue-i18n/no-raw-text': [
        'error',
        { ignorePattern: '^[\\s\\d.,:;!?()\\[\\]{}+\\-*/=×…·•|—–]+$' },
      ],
      '@intlify/vue-i18n/no-missing-keys': 'off',
      '@intlify/vue-i18n/no-unused-keys': 'off',
      '@intlify/vue-i18n/no-v-html': 'error',
    },
  },

  // Message files: sorted keys; camelCase keys in the app's own bundles (the  string catalog keeps its keys).
  ...jsonc.configs['flat/base'].map((c) => ({ ...c, files: ['src/shared/i18n/**/*.json'] })),
  {
    files: ['src/shared/i18n/**/*.json'],
    rules: { 'jsonc/sort-keys': 'error' },
  },
  {
    files: ['src/shared/i18n/*/{app,a11y,menu}.json'],
    plugins: { '@intlify/vue-i18n': i18nPlugin },
    settings: {
      'vue-i18n': {
        localeDir: { pattern: './src/shared/i18n/*/{app,a11y,menu}.json', localeKey: 'file' },
      },
    },
    rules: { '@intlify/vue-i18n/key-format-style': ['error', 'camelCase'] },
  },

  // Process boundaries: main, preload, host and renderer meet only through src/shared (02 §3).
  {
    files: ['src/**/*.{ts,vue}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'main', pattern: 'src/main/**' },
        { type: 'preload', pattern: 'src/preload/**' },
        { type: 'host', pattern: 'src/host/**' },
        { type: 'renderer', pattern: 'src/renderer/**' },
      ],
      'import/resolver': {
        typescript: {
          project: ['tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.preload.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'shared' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            {
              from: { element: { type: 'main' } },
              allow: { to: { element: { types: { anyOf: ['main', 'shared'] } } } },
            },
            {
              from: { element: { type: 'preload' } },
              allow: { to: { element: { types: { anyOf: ['preload', 'shared'] } } } },
            },
            {
              from: { element: { type: 'host' } },
              allow: { to: { element: { types: { anyOf: ['host', 'shared'] } } } },
            },
            {
              from: { element: { type: 'renderer' } },
              allow: { to: { element: { types: { anyOf: ['renderer', 'shared'] } } } },
            },
          ],
        },
      ],
    },
  },
  // src/shared is pure TS: no Node or DOM APIs (02 §3).
  {
    files: ['src/shared/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@actual-app/api',
              message: 'Only src/host/actual.ts may load @actual-app/api.',
            },
          ],
          patterns: [
            {
              group: ['node:*', 'electron', 'electron/*', 'vue', 'pinia'],
              message: 'src/shared is pure TypeScript.',
            },
          ],
        },
      ],
    },
  },

  // Tests.
  {
    files: [
      'src/**/*.test.ts',
      'eslint-rules/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tests/unit/**/*.ts',
      'tests/int/**/*.ts',
    ],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/expect-expect': 'error',
      // expect(value, message) names the failing case in loops (token, palette).
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
    },
  },
  {
    // The component gallery exists only in development builds (router.ts); its demo labels aren't UI text.
    files: ['src/renderer/screens/dev/**/*.vue'],
    rules: { '@intlify/vue-i18n/no-raw-text': 'off' },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-focused-test': 'error',
      'playwright/missing-playwright-await': 'error',
    },
  },

  // Disable comments must name the rule and say why.
  eslintComments.recommended,
  {
    rules: {
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
    },
  },

  // Prettier owns formatting: turn off every rule it covers. Must stay last.
  prettier,
);
