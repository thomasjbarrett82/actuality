import { describe, expect, it } from 'vitest';
import {
  dateFormatExample,
  defaultCurrency,
  defaultDateFormat,
  defaultNumberFormat,
  NUMBER_FORMAT_EXAMPLES,
} from './locale-defaults';

describe('Budget Setup defaults from the OS locale (07 §4)', () => {
  it('picks the region’s currency, or none', () => {
    expect(defaultCurrency('en-US')).toBe('USD');
    expect(defaultCurrency('de')).toBe('EUR');
    expect(defaultCurrency('ja-JP')).toBe('JPY');
    expect(defaultCurrency('en-AQ')).toBe('');
    expect(defaultCurrency('not a locale!')).toBe('');
  });

  it('maps the locale’s separators to an Actual number format', () => {
    expect(defaultNumberFormat('en-US')).toBe('comma-dot');
    expect(defaultNumberFormat('de-DE')).toBe('dot-comma');
    expect(defaultNumberFormat('fr-FR')).toBe('space-comma');
    expect(defaultNumberFormat('de-CH')).toBe('apostrophe-dot');
    expect(defaultNumberFormat('hi-IN')).toBe('comma-dot-in');
    expect(defaultNumberFormat('not a locale!')).toBe('comma-dot');
  });

  it('maps the locale’s date order and separator to an Actual date format', () => {
    expect(defaultDateFormat('en-US')).toBe('MM/dd/yyyy');
    expect(defaultDateFormat('en-GB')).toBe('dd/MM/yyyy');
    expect(defaultDateFormat('de-DE')).toBe('dd.MM.yyyy');
    expect(defaultDateFormat('sv-SE')).toBe('yyyy-MM-dd');
    expect(defaultDateFormat('not a locale!')).toBe('MM/dd/yyyy');
  });

  it('labels the formats', () => {
    expect(NUMBER_FORMAT_EXAMPLES['space-comma']).toBe('1 234,56');
    expect(dateFormatExample('MM/dd/yyyy')).toEqual({
      example: '12/31/2026',
      pattern: 'MM/DD/YYYY',
    });
    expect(dateFormatExample('dd.MM.yyyy')).toEqual({
      example: '31.12.2026',
      pattern: 'DD.MM.YYYY',
    });
  });
});
