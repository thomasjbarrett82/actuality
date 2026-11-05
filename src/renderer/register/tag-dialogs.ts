// Opening the Tags manager (04 §5.2, 07 §7). Its "View transactions" link opens All Accounts filtered by the
// tag, like Payee Settings' (14 §4).
import TagsManagerDialog from '../components/register/TagsManagerDialog.vue';
import { useAppStore } from '../stores/app';
import { useModals } from '../stores/modals';
import { useRegisterSession } from './view-state';

export async function openTagsManager(): Promise<void> {
  const result = await useModals().open<{ search: string }>(TagsManagerDialog);
  if (!result) return;
  const app = useAppStore();
  if (app.toAllAccounts()) useRegisterSession().view('all').search = result.search;
}
