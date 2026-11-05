// Opening the Rules dialog (23 §2): every rule, or the rules associated with one payee.
import type { Id } from '@shared/domain/types';
import RulesDialog from '../components/rules/RulesDialog.vue';
import { useModals } from '../stores/modals';

/** View ▸ Go to Rules (Ctrl+U), or a payee's associated rules (23 §2). */
export async function openRules(payeeId: Id | null = null): Promise<void> {
  await useModals().open<null>(RulesDialog, { payeeId });
}
