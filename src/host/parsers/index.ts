// Bank-file parsers (16 §1.3): Actual's own aren't in the public API, so the app has its own. Pure
// functions from bytes to a ParsedFile, picked by the file's extension.
import type { BankFormat, ParsedFile } from '@shared/import/import-rules';
import { parseCsv } from './csv';
import { parseOfx } from './ofx';
import { parseQif } from './qif';

export { CsvFormatError } from './csv';

/** The format a file name's extension names, or null for anything the import doesn't take. */
export function formatOf(fileName: string): BankFormat | null {
  const ext = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (ext === 'qif') return 'qif';
  if (ext === 'csv') return 'csv';
  return null;
}

export function parseBankFile(bytes: Uint8Array, format: BankFormat): ParsedFile {
  if (format === 'ofx') return parseOfx(bytes);
  if (format === 'qif') return parseQif(bytes);
  return parseCsv(bytes);
}
