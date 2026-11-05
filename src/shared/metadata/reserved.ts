// Reserved notes (04 §5.3): app metadata stored as versioned JSON in Actual notes with `ad:` ids. Each is
// validated with zod; unknown fields are kept, so a newer app's data survives an older app's write.
import { z } from 'zod';

/** Copies of notes that weren't valid JSON, made before the first overwrite (04 §5.3). */
export const BACKUP_PREFIX = 'ad-bak:';

const id = z.string().min(1);
const month = z.string().regex(/^\d{4}-\d{2}$/);

export const payeesMetaSchema = z.looseObject({ v: z.literal(1), disabled: z.array(id) });

export const cellNotesSchema = z.looseObject({ v: z.literal(1), notes: z.record(id, z.string()) });

export const importMappingSchema = z.looseObject({
  key: z.string().min(1),
  accountId: id.nullable(),
  importNotes: z.boolean(),
  swapPayeeNotes: z.boolean(),
  dateOrder: z.enum(['MDY', 'DMY', 'YMD']).optional(),
});

/**
 * The entries are read one by one (`usableMappings`): one this version can't read (a newer app's date
 * order, say) is kept as it is on writes but not used, so it doesn't reset every other mapping.
 */
export const importMappingsSchema = z.looseObject({
  v: z.literal(1),
  mappings: z.array(z.unknown()),
});

/** The `ad:import-mappings` entries this version can read. */
export function usableMappings(m: ImportMappings): ImportMapping[] {
  return m.mappings.flatMap((x) => {
    const parsed = importMappingSchema.safeParse(x);
    return parsed.success ? [parsed.data] : [];
  });
}

/** A field of a stored mapping entry, whether or not the entry is readable. */
export const mappingField = (entry: unknown, name: 'key' | 'accountId'): unknown =>
  typeof entry === 'object' && entry !== null
    ? (entry as Record<string, unknown>)[name]
    : undefined;

export const budgetMetaSchema = z.looseObject({
  v: z.literal(1),
  carryoverSeenEnd: month.optional(),
});

export type PayeesMeta = z.infer<typeof payeesMetaSchema>;
export type CellNotes = z.infer<typeof cellNotesSchema>;
export type ImportMapping = z.infer<typeof importMappingSchema>;
export type ImportMappings = z.infer<typeof importMappingsSchema>;
export type BudgetMeta = z.infer<typeof budgetMetaSchema>;

/** A reserved note kind: its id pattern, schema and the value an absent or empty note stands for. */
export interface ReservedKind<T> {
  schema: z.ZodType<T>;
  empty: T;
}

export const RESERVED = {
  payees: {
    schema: payeesMetaSchema,
    empty: { v: 1, disabled: [] },
  } satisfies ReservedKind<PayeesMeta>,
  cellNotes: {
    schema: cellNotesSchema,
    empty: { v: 1, notes: {} },
  } satisfies ReservedKind<CellNotes>,
  importMappings: {
    schema: importMappingsSchema,
    empty: { v: 1, mappings: [] },
  } satisfies ReservedKind<ImportMappings>,
  budget: { schema: budgetMetaSchema, empty: { v: 1 } } satisfies ReservedKind<BudgetMeta>,
} as const;

export const reservedIds = {
  payees: 'ad:payees',
  cellNotes: (m: string): string => `ad:cellnotes:${m}`,
  importMappings: 'ad:import-mappings',
  budget: 'ad:budget',
} as const;

export const backupIdFor = (noteId: string): string => `${BACKUP_PREFIX}${noteId}`;

export type ParseResult<T> =
  | { status: 'empty'; value: T }
  | { status: 'ok'; value: T }
  /** Not valid JSON, or not this schema: read as empty, and back up before the first overwrite. */
  | { status: 'invalid'; value: T; raw: string };

/** Reads a reserved note's text. `""`, `null` and a missing row all mean no note (04 §5.3). */
export function parseReserved<T>(
  kind: ReservedKind<T>,
  text: string | null | undefined,
): ParseResult<T> {
  if (text === null || text === undefined || text.trim() === '')
    return { status: 'empty', value: kind.empty };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: 'invalid', value: kind.empty, raw: text };
  }
  const parsed = kind.schema.safeParse(json);
  return parsed.success
    ? { status: 'ok', value: parsed.data }
    : { status: 'invalid', value: kind.empty, raw: text };
}

export const serializeReserved = (value: unknown): string => JSON.stringify(value);

/** True for metadata ids, never for backups: the `'ad:'`…`'ad;'` range the loader queries (04 §5.3). */
export const isReservedId = (noteId: string): boolean => noteId >= 'ad:' && noteId < 'ad;';
