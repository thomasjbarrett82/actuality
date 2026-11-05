// Pinned settings, so Prettier upgrades don't reformat the codebase (21 §4.3).
/** @type {import('prettier').Config} */
export default {
  printWidth: 100,
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  arrowParens: 'always',
  endOfLine: 'lf',
  vueIndentScriptAndStyle: false,
  plugins: ['prettier-plugin-organize-imports'],
  overrides: [{ files: '*.md', options: { proseWrap: 'preserve' } }],
};
