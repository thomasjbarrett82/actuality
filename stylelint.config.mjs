// stylelint (21 §4.2): colors and sizes only from tokens, simple scoped selectors.
// tokens.css is the one place hex colors and px values may be defined.
const pxAllowed = [
  'border',
  'border-width',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'outline',
  'outline-width',
  'outline-offset',
  'box-shadow',
  'text-shadow',
];

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard', 'stylelint-config-recommended-vue'],
  // The user guide site (website/) isn't the app: Docusaurus themes are set with literal colors, not tokens.
  ignoreFiles: [
    'out/**',
    'dist/**',
    'coverage/**',
    'node_modules/**',
    'references/**',
    'website/**',
  ],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklch',
      'color',
    ],
    // px only where 05 §3.5 allows it: 1 px borders and hairlines, the 2 px focus ring, shadows.
    'unit-disallowed-list': ['px', { ignoreProperties: { px: pxAllowed } }],
    'selector-max-id': 0,
    'selector-max-specificity': '0,3,0',
    'selector-max-compound-selectors': 3,
    'declaration-no-important': true,
    'selector-class-pattern': null,
    'custom-property-pattern': null,
  },
  overrides: [
    {
      files: ['src/renderer/styles/tokens.css'],
      rules: {
        'color-no-hex': null,
        'color-hex-length': null,
        'color-named': null,
        'function-disallowed-list': null,
        'unit-disallowed-list': null,
        'declaration-no-important': null,
      },
    },
  ],
};
