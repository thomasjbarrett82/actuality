import { describe, expect, it } from 'vitest';
import { availableLocales, fallbackChain, LOCALE_META, MESSAGES, resolveLocale } from './locales';
import { createTranslator, interpolate } from './translate';

describe('locales (20 §3)', () => {
  it('discovers en with its metadata', () => {
    expect(MESSAGES['en']?.['taskDialog']?.['OkLabel']).toBe('Ok');
    expect(LOCALE_META['en']).toMatchObject({ name: 'English', dir: 'ltr' });
  });

  it('builds the fallback chain', () => {
    expect(fallbackChain('pt-BR')).toEqual(['pt-BR', 'pt', 'en']);
    expect(fallbackChain('de')).toEqual(['de', 'en']);
    expect(fallbackChain('en')).toEqual(['en']);
  });

  it('resolves the UI language from the setting and the OS (20 §3.3)', () => {
    const available = ['de', 'en', 'pt-BR'];
    expect(resolveLocale('de', [], available)).toBe('de');
    expect(resolveLocale('xx', ['pt-BR'], available)).toBe('pt-BR');
    expect(resolveLocale('system', ['fr-FR', 'de-AT'], available)).toBe('de');
    expect(resolveLocale('system', ['PT-br'], available)).toBe('pt-BR');
    expect(resolveLocale('system', ['ja'], available)).toBe('en');
  });

  it('lists incomplete locales only in development builds (20 §3.5)', () => {
    const messages = {
      en: { a: { x: '1', y: '2' } },
      de: { a: { x: 'eins' } },
      fr: { a: { x: 'un', y: 'deux' } },
    };
    expect(availableLocales(false, messages)).toEqual(['en', 'fr']);
    expect(availableLocales(true, messages)).toEqual(['de', 'en', 'fr']);
  });
});

describe('translate (20 §3.4)', () => {
  const messages = {
    en: {
      m: {
        hi: 'Hello {name}',
        pos: '{0} of {1}',
        app: 'About Actuality',
        esc: "a {'@'} b",
        deleted: '1 Transaction has been deleted | {n} Transactions have been deleted',
        only: 'English only',
      },
    },
    de: { m: { hi: 'Hallo {name}' } },
    'de-AT': { m: {} },
  };

  it('translates with named and positional params', () => {
    const t = createTranslator('de-AT', messages);
    expect(t('m.hi', { name: 'Ana' })).toBe('Hallo Ana');
    expect(t('m.pos', ['3', 7])).toBe('3 of 7');
    expect(t('m.app')).toBe('About Actuality');
    expect(t('m.esc')).toBe('a @ b');
    expect(t('m.only')).toBe('English only');
    expect(t('m.missing')).toBe('m.missing');
  });

  it('picks plural forms', () => {
    const t = createTranslator('en', messages);
    expect(t('m.deleted', { n: 1 })).toBe('1 Transaction has been deleted');
    expect(t('m.deleted', { n: 3 })).toBe('3 Transactions have been deleted');
    expect(t('m.deleted', { n: 0 })).toBe('0 Transactions have been deleted');
  });

  it('leaves unknown placeholders in place', () => {
    expect(interpolate('{0} and {x}', ['a'])).toBe('a and {x}');
    expect(interpolate('{0}', { x: 1 })).toBe('{0}');
  });
});
