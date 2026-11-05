// Pure checks behind `npm run i18n:check` (20 §3.7) and the pseudo-locale (20 §3.6).

/** One `{…}` token: a placeholder name, or a quoted literal escape. */
const TOKEN = /\{(?:'[^']*'|([A-Za-z0-9_]+))\}/g;

/** Placeholder names in a message (sorted, unique), excluding literal escapes. */
export function placeholders(message: string): string[] {
  const names = new Set<string>();
  for (const m of message.matchAll(TOKEN)) if (m[1]) names.add(m[1]);
  return [...names].sort();
}

/** Problems with a message's syntax and rich-text markup; empty when it's valid. */
export function syntaxProblems(message: string): string[] {
  const problems: string[] = [];
  const stripped = message.replace(TOKEN, '');
  if (/[{}]/.test(stripped)) problems.push('unbalanced or invalid { } placeholder');
  if (/[@$]/.test(stripped)) problems.push("unescaped @ or $ (write {'@'})");
  const names = placeholders(message);
  if (names.some((n) => /^\d+$/.test(n)) && names.some((n) => !/^\d+$/.test(n))) {
    problems.push('mixes positional {0} and named placeholders');
  }
  const tags: string[] = [];
  // Only HTML tags are markup: text like "<Blank>" (common.BLANK_SEARCH_STRING) is literal.
  for (const m of message.matchAll(
    /<(\/?)(a|b|i|u|p|br|pre|font|strong|em)(?![a-z])[^>]*?(\/?)>/gi,
  )) {
    const [, closing, name = '', selfClosing] = m;
    const tag = name.toLowerCase();
    if (selfClosing || tag === 'br') continue;
    if (!closing) tags.push(tag);
    else if (tags.pop() !== tag) problems.push(`markup: unexpected </${tag}>`);
  }
  if (tags.length > 0) problems.push(`markup: unclosed <${tags.join('>, <')}>`);
  if ((message.match(/\*\*/g) ?? []).length % 2 !== 0) problems.push('markup: unbalanced **');
  if ((message.replace(/\*\*/g, '').match(/\*/g) ?? []).length % 2 !== 0)
    problems.push('markup: unbalanced *');
  return problems;
}

/** Plural forms of a message ("a | b" → 2). */
export function pluralForms(message: string): number {
  return message.replace(TOKEN, '').split(/\s\|\s/).length;
}

/** Allowed plural form counts for a language: its CLDR categories, plus an optional leading zero form. */
export function allowedPluralForms(locale: string): number[] {
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.length;
  return [categories, categories + 1];
}

export interface LocaleMetaInput {
  name?: unknown;
  englishName?: unknown;
  dateFnsLocale?: unknown;
  dir?: unknown;
}

export function metaProblems(
  meta: LocaleMetaInput | undefined,
  dateFnsLocales: ReadonlySet<string>,
): string[] {
  if (!meta) return ['meta.json is missing or not JSON'];
  const problems: string[] = [];
  if (typeof meta.name !== 'string' || !meta.name) problems.push('meta.json: name is missing');
  if (typeof meta.englishName !== 'string' || !meta.englishName)
    problems.push('meta.json: englishName is missing');
  if (typeof meta.dateFnsLocale !== 'string' || !dateFnsLocales.has(meta.dateFnsLocale)) {
    problems.push(`meta.json: date-fns has no locale ${String(meta.dateFnsLocale)}`);
  }
  if (meta.dir === 'rtl')
    problems.push('meta.json: right-to-left languages are out of scope for v1');
  else if (meta.dir !== 'ltr') problems.push('meta.json: dir must be "ltr"');
  return problems;
}

export type Messages = Record<string, Record<string, string>>;

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

/** Compares one locale with the English source. Missing keys are warnings: the locale stays dev-only. */
export function checkLocale(locale: string, messages: Messages, source: Messages): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowed = allowedPluralForms(locale);
  for (const [bundle, keys] of Object.entries(source)) {
    for (const [key, en] of Object.entries(keys)) {
      const id = `${locale}/${bundle}.${key}`;
      const value = messages[bundle]?.[key];
      if (value === undefined) {
        warnings.push(`${id}: missing`);
        continue;
      }
      for (const p of syntaxProblems(value)) errors.push(`${id}: ${p}`);
      if (placeholders(value).join() !== placeholders(en).join()) {
        errors.push(`${id}: placeholders {${placeholders(value).join('}, {')}} differ from en`);
      }
      if (pluralForms(en) > 1 && !allowed.includes(pluralForms(value))) {
        errors.push(
          `${id}: ${String(pluralForms(value))} plural forms; ${locale} needs ${allowed.join(' or ')}`,
        );
      }
    }
  }
  for (const [bundle, keys] of Object.entries(messages)) {
    for (const key of Object.keys(keys)) {
      if (source[bundle]?.[key] === undefined) errors.push(`${locale}/${bundle}.${key}: not in en`);
    }
  }
  return { errors, warnings };
}

/** Checks the source locale itself: valid syntax and plural forms. */
export function checkSource(source: Messages): string[] {
  const errors: string[] = [];
  const allowed = allowedPluralForms('en');
  for (const [bundle, keys] of Object.entries(source)) {
    for (const [key, value] of Object.entries(keys)) {
      for (const p of syntaxProblems(value)) errors.push(`en/${bundle}.${key}: ${p}`);
      if (pluralForms(value) > 1 && !allowed.includes(pluralForms(value))) {
        errors.push(`en/${bundle}.${key}: ${String(pluralForms(value))} plural forms`);
      }
    }
  }
  return errors;
}

const ACCENTS: Record<string, string> = {
  a: 'à',
  b: 'ƀ',
  c: 'ç',
  d: 'đ',
  e: 'é',
  f: 'ƒ',
  g: 'ğ',
  h: 'ħ',
  i: 'ï',
  j: 'ĵ',
  k: 'ķ',
  l: 'ł',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ü',
  w: 'ŵ',
  y: 'ý',
  z: 'ž',
  A: 'À',
  B: 'Ƀ',
  C: 'Ç',
  D: 'Đ',
  E: 'É',
  G: 'Ğ',
  H: 'Ħ',
  I: 'Ï',
  K: 'Ķ',
  L: 'Ł',
  N: 'Ñ',
  O: 'Ö',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ü',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * en-XA (20 §3.6): each value accented, padded by 40 % and wrapped in fullwidth brackets ［ ］, keeping
 * placeholders, escapes, markup and plural separators intact.
 */
export function pseudoLocalize(message: string): string {
  return message
    .split(/(\s\|\s)/)
    .map((form, i) => {
      if (i % 2 === 1) return form;
      if (form === '') return form;
      const accented = form.replace(
        /(\{[^}]*\}|<[^>]*>|\*+|Actuality)|([A-Za-z])/g,
        (whole, keep: string | undefined, ch: string | undefined) =>
          keep ?? (ch ? (ACCENTS[ch] ?? ch) : whole),
      );
      const visible = form.replace(/\{[^}]*\}|<[^>]*>|Actuality/g, '').length;
      return `［${accented}${'~'.repeat(Math.ceil(visible * 0.4))}］`;
    })
    .join('');
}

/** A quoted `bundle.key` literal: how code names a message (`t('app.signIn')`, `{ label: 'a11y.calcAdd' }`). */
const KEY_LITERAL = /(['"`])([a-zA-Z][a-zA-Z0-9]*\.[A-Za-z0-9_]+)\1/g;

/**
 * Key usage (20 §3.7): every key passed to `t()` exists in en, and every en key is used somewhere in
 * src/ or is still pending. `code` is the concatenated source; keys are recognized as quoted literals.
 */
export function keyUsage(
  source: Messages,
  code: string,
  pending: readonly string[],
): { missing: string[]; unused: string[] } {
  const known = new Set(
    Object.entries(source).flatMap(([bundle, keys]) =>
      Object.keys(keys).map((k) => `${bundle}.${k}`),
    ),
  );
  const bundles = new Set(Object.keys(source));
  const used = new Set<string>();
  for (const m of code.matchAll(KEY_LITERAL)) {
    const key = m[2] ?? '';
    if (bundles.has(key.split('.')[0] ?? '')) used.add(key);
  }
  const missing = new Set<string>();
  for (const m of code.matchAll(/\$?\bt\(\s*(['"`])([^'"`]+)\1/g)) {
    const key = m[2] ?? '';
    if (!known.has(key)) missing.add(key);
  }
  const pendingSet = new Set(pending);
  const unused = [...known].filter((k) => !used.has(k) && !pendingSet.has(k));
  return { missing: [...missing].sort(), unused: unused.sort() };
}
