// The redaction step (02 §8.4): the last thing before an entry is written. A safety net: aspects aren't
// meant to pass secrets or long text, and a test fails when one gets through.

export const REDACTED = '[redacted]';
export const MAX_STRING = 500;
export const MAX_DEPTH = 6;
export const SECRET_KEY = /pass(word)?|token|secret|authorization|cookie|key/i;

export interface RedactOptions {
  /** The home folder, shown as `~` in paths. */
  home?: string;
}

/** The home folder as it appears in text: as is, with forward slashes, and JSON- or repr-escaped. */
function homeForms(home: string): string[] {
  const forward = home.replaceAll('\\', '/');
  const escaped = home.replaceAll('\\', '\\\\');
  return [...new Set([escaped, home, forward])];
}

function text(s: string, opts: RedactOptions): string {
  let out = s;
  if (opts.home && opts.home.length > 1)
    for (const form of homeForms(opts.home)) out = out.split(form).join('~');
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

/** A copy of `value` with secret-looking keys replaced, long strings cut, and the home folder hidden. */
export function redact(value: unknown, opts: RedactOptions = {}, depth = 0): unknown {
  if (typeof value === 'string') return text(value, opts);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v: unknown) => redact(v, opts, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, opts, depth + 1);
  }
  return out;
}
