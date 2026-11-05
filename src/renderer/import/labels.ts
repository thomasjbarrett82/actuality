// The file account's name in the import prompt and results (16 §1.4): "{ACCTTYPE or QIF type}:
// ********{last 4}", either part may be missing, and "this file" if both are.
import { maskedNumber, type ParsedAccount } from '@shared/import/import-rules';
import { tr } from '../register/dialogs';

export function bankAccountLabel(a: ParsedAccount): string {
  const parts = [a.type, a.number ? maskedNumber(a.number) : null].filter(
    (p): p is string => p !== null && p !== '',
  );
  if (parts.length === 0) return tr('app.impThisFile');
  return parts.length === 2 ? `${parts[0] ?? ''}: ${parts[1] ?? ''}` : (parts[0] ?? '');
}
