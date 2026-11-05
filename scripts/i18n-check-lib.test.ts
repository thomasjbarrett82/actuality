import { describe, expect, it } from 'vitest';
import {
  allowedPluralForms,
  checkLocale,
  checkSource,
  keyUsage,
  metaProblems,
  placeholders,
  pluralForms,
  pseudoLocalize,
  syntaxProblems,
} from './i18n-check-lib';

describe('i18n checks (20 §3.7)', () => {
  it('reads placeholders and ignores literal escapes', () => {
    expect(placeholders("{1} of {0} for Actuality {'@'}")).toEqual(['0', '1']);
    expect(placeholders('{Actuality}')).toEqual(['Actuality']);
    expect(placeholders('{name} and {name}')).toEqual(['name']);
  });

  it('finds syntax and markup problems', () => {
    expect(syntaxProblems('Hello {name}, <b>bold</b> **x** *y*<br/>')).toEqual([]);
    expect(syntaxProblems('broken {name')).toEqual(['unbalanced or invalid { } placeholder']);
    expect(syntaxProblems('mail@x')).toEqual(["unescaped @ or $ (write {'@'})"]);
    expect(syntaxProblems('{0} and {name}')).toEqual([
      'mixes positional {0} and named placeholders',
    ]);
    expect(syntaxProblems('<b>open')).toEqual(['markup: unclosed <b>']);
    expect(syntaxProblems('</i>')).toEqual(['markup: unexpected </i>']);
    expect(syntaxProblems('**a')).toEqual(['markup: unbalanced **']);
    expect(syntaxProblems('*a')).toEqual(['markup: unbalanced *']);
  });

  it('counts plural forms against CLDR', () => {
    expect(pluralForms('one | {n} many')).toBe(2);
    expect(pluralForms("a {'|'} b")).toBe(1);
    expect(allowedPluralForms('en')).toEqual([2, 3]);
    expect(allowedPluralForms('pl')).toEqual([4, 5]);
  });

  it('validates meta.json', () => {
    const fns = new Set(['de', 'enUS']);
    expect(
      metaProblems(
        { name: 'Deutsch', englishName: 'German', dateFnsLocale: 'de', dir: 'ltr' },
        fns,
      ),
    ).toEqual([]);
    expect(metaProblems(undefined, fns)).toEqual(['meta.json is missing or not JSON']);
    expect(
      metaProblems({ name: '', englishName: 1, dateFnsLocale: 'xx', dir: 'rtl' }, fns),
    ).toHaveLength(4);
    expect(
      metaProblems({ name: 'a', englishName: 'b', dateFnsLocale: 'de', dir: 'up' }, fns),
    ).toEqual(['meta.json: dir must be "ltr"']);
  });

  it('compares a locale with en', () => {
    const en = { b: { hi: 'Hello {name}', count: '1 thing | {n} things', bye: 'Bye' } };
    const de = {
      b: { hi: 'Hallo {nme}', count: 'ein Ding | {n} Dinge | x | y' },
      extra: { k: 'v' },
    };
    const result = checkLocale('de', de, en);
    expect(result.warnings).toEqual(['de/b.bye: missing']);
    expect(result.errors).toEqual([
      'de/b.hi: placeholders {nme} differ from en',
      'de/b.count: 4 plural forms; de needs 2 or 3',
      'de/extra.k: not in en',
    ]);
    expect(checkSource({ b: { bad: '{x', plural: 'a | b | c | d' } })).toEqual([
      'en/b.bad: unbalanced or invalid { } placeholder',
      'en/b.plural: 4 plural forms',
    ]);
  });

  it('pseudo-localizes, keeping placeholders, markup and plural forms', () => {
    expect(pseudoLocalize('Budget')).toBe('［Ƀüđğéţ~~~］');
    expect(pseudoLocalize('Hi {name} <b>x</b>')).toBe('［Ħï {name} <b>x</b>~~］');
    expect(pseudoLocalize('About Actuality')).toBe('［Àƀöüţ Actuality~~~］');
    expect(pseudoLocalize('1 one | {n} many')).toBe('［1 öñé~~］ | ［{n} ɱàñý~~］');
    expect(pseudoLocalize('')).toBe('');
  });

  it('finds keys used but missing, and keys never used', () => {
    const source = {
      app: { signIn: 'Sign in', quit: 'Quit', later: 'Later' },
      a11y: { calcAdd: 'Add' },
    };
    const code =
      "t('app.signIn'); $t(\"app.typo\"); const m = { label: 'a11y.calcAdd' }; open('app.log');";
    expect(keyUsage(source, code, ['app.later'])).toEqual({
      missing: ['app.typo'],
      unused: ['app.quit'],
    });
  });
});
