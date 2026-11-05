// Conventional commits (21 §4.6): type(scope): subject, imperative, no trailing full stop, header <= 100.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'main',
        'host',
        'renderer',
        'shared',
        'budget',
        'register',
        'reports',
        'sidebar',
        'import',
        'i18n',
        'a11y',
        'theme',
        'spec',
        'deps',
        'ci',
        'style',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    'subject-full-stop': [2, 'never', '.'],
  },
};
