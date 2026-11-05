// The shape of a value, for debug entries (02 §8.4): what kind of thing was passed or returned, never the
// thing itself. Objects give their top-level key names (`fields`: a `keys` property would be redacted),
// arrays their length; strings their type only.

export type Shape =
  | 'undefined'
  | 'null'
  | 'string'
  | 'number'
  | 'boolean'
  | 'function'
  | 'other'
  | { array: number }
  | { fields: string[] };

export function shape(value: unknown): Shape {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return { array: value.length };
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'function':
      return 'function';
    case 'object':
      return { fields: Object.keys(value).sort() };
    default:
      return 'other';
  }
}
