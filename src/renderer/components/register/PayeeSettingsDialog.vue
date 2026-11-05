<script setup lang="ts">
// Payee Settings (14 §4): the payee list (all payees, transfers included, alphabetical, multi-select,
// with a filter) and the selection's settings: name, listing and auto-complete, auto-category, and rename
// rules for one payee, and its other rules (23 §2.1); combine and enable/disable for several. The footer
// holds the three auto-fill preferences. Changes apply live. Offline, everything but the selection is
// read-only.
import { ENGLISH_TRANSFER_PREFIX, transferAccountName } from '@shared/domain/payees';
import { isAssociated } from '@shared/domain/rules';
import type { Id, Payee, RenameCondition } from '@shared/domain/types';
import { useQuery } from '@tanstack/vue-query';
import { Info, Minus, Plus } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../../i18n';
import { useAccounts, useCategories, usePayees, useRules } from '../../queries/budget-data';
import { attempt, tell } from '../../register/dialogs';
import { resolveCategory, type NewCategory } from '../../register/editable';
import { ADD_CATEGORY_ITEM, categoryEntries, categoryFilter } from '../../register/entries';
import { programmatic, uiSearchWords } from '../../register/search';
import { host } from '../../rpc/host-client';
import { openRules } from '../../rules/dialogs';
import { openRuleEditor } from '../../rules/editor';
import { formForPayee, formOf } from '../../rules/form';
import { useBudgetSettings } from '../../stores/budget-settings';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useModals } from '../../stores/modals';
import { useSettings } from '../../stores/settings';
import type { AutoCompleteItem } from '../common/autocomplete-list';
import AutoComplete from '../common/AutoComplete.vue';
import { escapeRichText } from '../common/rich-text';
import RichText from '../common/RichText.vue';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';
import UiLink from '../common/UiLink.vue';
import UiSmallButton from '../common/UiSmallButton.vue';
import AddCategoryDialog from './AddCategoryDialog.vue';

const props = defineProps<{ initialId: Id | null }>();
const emit = defineEmits<{ close: [result: { search: string } | null] }>();
const { t } = useI18n();
const payeesQ = usePayees();
const accountsQ = useAccounts();
const categoriesQ = useCategories();
const connection = useConnection();
const settings = useSettings();
const budgetSettings = useBudgetSettings();
const dialogs = useDialogs();
const modals = useModals();
const canEdit = computed(() => connection.canEdit);

const accounts = computed(() => new Map((accountsQ.data.value ?? []).map((a) => [a.id, a])));
const displayName = (p: Payee): string =>
  p.transferAccountId
    ? t('app.transferPayee', { account: accounts.value.get(p.transferAccountId)?.name ?? p.name })
    : p.name;
const all = computed(() =>
  [...(payeesQ.data.value ?? [])].sort((a, b) =>
    displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }),
  ),
);
const filter = ref('');
const listed = computed(() => {
  const f = filter.value.trim().toLocaleLowerCase();
  return f === ''
    ? all.value
    : all.value.filter((p) => displayName(p).toLocaleLowerCase().includes(f));
});

// ----------------------------------------------------------------------------------- selection

const selected = ref<Set<Id>>(new Set(props.initialId ? [props.initialId] : []));
const selectedPayees = computed(() => all.value.filter((p) => selected.value.has(p.id)));
const single = computed(() =>
  selectedPayees.value.length === 1 ? selectedPayees.value[0] : undefined,
);

function toggle(id: Id, e: MouseEvent | KeyboardEvent): void {
  const next = new Set(e.ctrlKey || e.metaKey ? selected.value : []);
  if (next.has(id) && (e.ctrlKey || e.metaKey)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
function check(id: Id): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

watch(
  single,
  (p, before) => {
    if (before && before.id !== p?.id) void flushRules(before.id, true);
    editingName.value = false;
    if (p) void budgetSettings.patch({ payeeSettings: { lastPayeeId: p.id } });
  },
  { flush: 'sync' },
);

// ----------------------------------------------------------------------------------- rules

const rulesQ = useQuery(
  computed(() => ({
    queryKey: ['payees', 'rules', single.value?.id ?? ''] as const,
    queryFn: () => host.call('payees.rules', { id: single.value?.id ?? '' }),
    enabled: single.value !== undefined,
  })),
);
/** The rules being edited; blank ones are dropped when the selection changes (14 §4). */
const rules = ref<RenameCondition[]>([]);
watch(
  () => rulesQ.data.value,
  (r) => {
    rules.value = (r?.renameRules ?? []).map((c) => ({ ...c }));
  },
  { immediate: true },
);
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function flushRules(id: Id, dropBlank: boolean): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!canEdit.value) return;
  const kept = rules.value.filter((r) => r.value.trim() !== '');
  if (dropBlank) rules.value = kept;
  const before = rulesQ.data.value?.renameRules ?? [];
  if (JSON.stringify(kept) === JSON.stringify(before)) return;
  await attempt(() => host.call('payees.setRenameRules', { id, conditions: kept }));
}

/** Rule edits save on blur, debounced 500 ms (14 §4). */
function scheduleSave(): void {
  const id = single.value?.id;
  if (!id) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushRules(id, false), 500);
}

function addRule(): void {
  rules.value = [...rules.value, { op: 'contains', value: '' }];
  void nextTick(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-rule-value]');
    inputs[inputs.length - 1]?.focus();
  });
}
function removeRule(i: number): void {
  rules.value = rules.value.filter((_, j) => j !== i);
  scheduleSave();
}
const lastRuleBlank = computed(() => (rules.value.at(-1)?.value.trim() ?? '') === '');

async function renameExisting(): Promise<void> {
  const p = single.value;
  if (!p) return;
  await flushRules(p.id, true);
  const dry = await host.call('payees.applyRenameRules', { id: p.id, dryRun: true });
  if (dry.count === 0) {
    await tell(
      t('app.payeeSettingsNoMatchTitle'),
      t('app.payeeSettingsNoMatchMessage'),
      'info',
      'ok',
    );
    return;
  }
  const { button } = await dialogs.showTaskDialog({
    instruction: t(
      'app.payeeSettingsApplyOne',
      { count: dry.count, name: displayName(p) },
      dry.count,
    ),
    content: t('app.payeeSettingsAffected', {
      names: dry.payeeNames.map((n) => `'${escapeRichText(n)}'`).join(', '),
    }),
    footer: t('app.payeeSettingsApplyFooter'),
    icon: 'info',
    buttons: [
      { id: 'rename', label: t('app.payeeSettingsRenameTransactions'), isDefault: true },
      'cancel',
    ],
  });
  if (button === 'rename')
    await attempt(() => host.call('payees.applyRenameRules', { id: p.id, dryRun: false }));
}

// ----------------------------------------------------------------------------------- other rules

const allRulesQ = useRules();
const associated = computed(() => {
  const p = single.value;
  return p ? (allRulesQ.data.value ?? []).filter((r) => isAssociated(r, p.id)).length : 0;
});

/** "{n} associated rules", "Create a New Rule" and "Other rule (edit in Rules)" (23 §2.1). */
async function showRules(): Promise<void> {
  const p = single.value;
  if (!p) return;
  await flushRules(p.id, false);
  await openRules(p.id);
}
async function createRule(): Promise<void> {
  const p = single.value;
  if (!p) return;
  await flushRules(p.id, false);
  await openRuleEditor(formForPayee(p.id));
}
async function editRule(id: Id): Promise<void> {
  const rule = (allRulesQ.data.value ?? []).find((r) => r.id === id);
  if (rule) await openRuleEditor(formOf(rule));
}

const OPS: { op: RenameCondition['op']; key: string }[] = [
  { op: 'contains', key: 'app.payeeSettingsContains' },
  { op: 'is', key: 'app.payeeSettingsIs' },
  { op: 'startsWith', key: 'app.payeeSettingsStartsWith' },
  { op: 'endsWith', key: 'app.payeeSettingsEndsWith' },
];

// ----------------------------------------------------------------------------------- name

const editingName = ref(false);
const nameText = ref('');
const nameInput = ref<HTMLInputElement | null>(null);
function startRename(): void {
  const p = single.value;
  if (!p || p.transferAccountId || !canEdit.value) return;
  nameText.value = p.name;
  editingName.value = true;
  void nextTick(() => nameInput.value?.select());
}
async function saveName(): Promise<void> {
  const p = single.value;
  if (!p) return;
  const typed = nameText.value.trim();
  editingName.value = false;
  // Blank or unchanged reverts; a transfer name is refused (14 §4).
  if (typed === '' || typed === p.name) return;
  if (transferAccountName(typed, [t('app.transferPrefix'), ENGLISH_TRANSFER_PREFIX]) !== null) {
    await tell(
      t('app.editInvalidPayeeTitle'),
      t('app.editInvalidTransferMessage', { name: escapeRichText(typed) }),
    );
    return;
  }
  const result = await attempt(() => host.call('payees.rename', { id: p.id, name: typed }));
  if (result.ok) selected.value = new Set([result.value.id]);
}

// ----------------------------------------------------------------------------------- listing

async function setEnabled(ids: readonly Id[], enabled: boolean): Promise<void> {
  const list = ids.filter((id) => !all.value.find((p) => p.id === id)?.transferAccountId);
  if (list.length > 0) await attempt(() => host.call('payees.setEnabled', { ids: list, enabled }));
}

function showTransactions(): void {
  const p = single.value;
  if (!p) return;
  emit('close', { search: programmatic.payee(uiSearchWords(dateLocale.value), displayName(p)) });
}

// ----------------------------------------------------------------------------------- category

const categoryList = computed(() =>
  categoryEntries(categoriesQ.data.value ?? [], { addNew: t('register.addNewCategory') }),
);
const autoCategoryText = computed(() => {
  const id = rulesQ.data.value?.autoCategoryId ?? null;
  for (const g of categoriesQ.data.value ?? []) {
    const c = g.categories.find((x) => x.id === id);
    if (c) return `${g.name}: ${c.name}`;
  }
  return '';
});
async function onAutoCategory(value: string, item: AutoCompleteItem | null): Promise<void> {
  const p = single.value;
  if (!p || !canEdit.value) return;
  let categoryId: Id | null;
  const res =
    item?.id === ADD_CATEGORY_ITEM
      ? null
      : resolveCategory(value, '\u0000', categoriesQ.data.value ?? []);
  if (res === null || res.kind === 'new') {
    const created = await modals.open<NewCategory>(AddCategoryDialog, {
      groups: categoriesQ.data.value ?? [],
      groupName: res?.kind === 'new' ? res.groupName : '',
      name: res?.kind === 'new' ? res.name : '',
    });
    if (!created) return;
    categoryId = created.id;
  } else categoryId = res.kind === 'category' ? res.id : null;
  if (categoryId === (rulesQ.data.value?.autoCategoryId ?? null)) return;
  await attempt(() => host.call('payees.setAutoCategory', { id: p.id, categoryId }));
}

// ----------------------------------------------------------------------------------- combine

const combineName = ref('');
watch(
  selectedPayees,
  (list) => {
    if (list.length > 1) combineName.value = list.find((p) => !p.transferAccountId)?.name ?? '';
  },
  { immediate: true },
);
async function combine(): Promise<void> {
  const name = combineName.value.trim();
  if (name === '') return;
  const ids = selectedPayees.value.filter((p) => !p.transferAccountId).map((p) => p.id);
  if (ids.length === 0) return;
  const result = await attempt(() => host.call('payees.combine', { ids, name }));
  if (result.ok) selected.value = new Set([result.value.id]);
}

// ----------------------------------------------------------------------------------- footer

async function setPref(
  key: 'autofillCategory' | 'autofillNotes' | 'autofillAmount',
  e: Event,
): Promise<void> {
  await settings.set(key, (e.target as HTMLInputElement).checked);
}

function close(): void {
  const p = single.value;
  if (p) void flushRules(p.id, true);
  emit('close', null);
}

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});
</script>

<template>
  <StandardDialog
    :title="t('register.payeeSettings')"
    width="xl"
    height="39rem"
    @cancel="close"
    @submit="close"
  >
    <div class="payee-settings">
      <div class="payee-settings__list-pane">
        <input
          v-model="filter"
          class="payee-settings__filter"
          type="search"
          :placeholder="t('app.payeeSettingsFilter')"
          :aria-label="t('app.payeeSettingsFilter')"
        />
        <ul
          class="payee-settings__list"
          role="listbox"
          aria-multiselectable="true"
          :aria-label="t('register.payeeSettings')"
        >
          <li
            v-for="p in listed"
            :key="p.id"
            role="option"
            class="payee-settings__item"
            :class="{ 'is-selected': selected.has(p.id) }"
            :aria-selected="selected.has(p.id)"
            tabindex="0"
            @click="toggle(p.id, $event)"
            @keydown.enter.prevent="toggle(p.id, $event)"
            @keydown.space.prevent="check(p.id)"
          >
            <span
              class="payee-settings__box"
              :class="{ 'is-checked': selected.has(p.id) }"
              aria-hidden="true"
              data-check
              @click.stop="check(p.id)"
            />
            <span class="payee-settings__name">{{ displayName(p) }}</span>
          </li>
        </ul>
      </div>

      <div class="payee-settings__detail">
        <p v-if="selectedPayees.length === 0" class="payee-settings__empty">
          {{ t('app.payeeSettingsSelect') }}
        </p>

        <template v-else-if="single">
          <div class="payee-settings__title-row">
            <template v-if="editingName">
              <input
                ref="nameInput"
                v-model="nameText"
                class="payee-settings__name-input"
                type="text"
                data-own-enter
                :aria-label="t('register.newPayeeNameLabel')"
                @keydown.enter.stop.prevent="saveName"
                @keydown.esc.stop.prevent="editingName = false"
              />
              <UiSmallButton @click="saveName">{{ t('app.payeeSettingsSave') }}</UiSmallButton>
              <UiLink @click="editingName = false">{{ t('app.payeeSettingsCancel') }}</UiLink>
            </template>
            <template v-else>
              <button
                type="button"
                class="payee-settings__title"
                :disabled="!!single.transferAccountId || !canEdit"
                @click="startRename"
              >
                {{ displayName(single) }}
              </button>
              <UiSmallButton
                v-if="!single.transferAccountId"
                :disabled="!canEdit"
                @click="startRename"
              >
                {{ t('app.payeeSettingsRename') }}
              </UiSmallButton>
            </template>
          </div>

          <div class="payee-settings__row">
            <label class="payee-settings__check">
              <input
                type="checkbox"
                :checked="single.enabled"
                :disabled="!!single.transferAccountId || !canEdit"
                @change="setEnabled([single.id], ($event.target as HTMLInputElement).checked)"
              />
              {{ t('app.payeeSettingsList') }}
            </label>
            <span v-if="single.usageCount > 0">
              {{ t('app.payeeSettingsUsedPrefix')
              }}<UiLink v-tooltip="t('app.payeeSettingsUsedTooltip')" @click="showTransactions"
                ><strong>{{
                  t('app.payeeSettingsUsedLink', { n: single.usageCount })
                }}</strong></UiLink
              >{{ t('app.payeeSettingsUsedSuffix') }}
            </span>
            <span v-else>{{ t('app.payeeSettingsUsedNone') }}</span>
            <Info
              v-tooltip="t('app.payeeSettingsListInfo')"
              class="payee-settings__info"
              :aria-label="t('app.payeeSettingsListInfo')"
            />
          </div>

          <hr class="payee-settings__rule" />

          <div class="payee-settings__row">
            <span>{{ t('app.payeeSettingsAutoCategory') }}</span>
            <div class="payee-settings__category" data-own-enter>
              <AutoComplete
                :model-value="autoCategoryText"
                :entries="categoryList"
                :filter="categoryFilter"
                :label="t('app.payeeSettingsAutoCategory')"
                :disabled="!canEdit"
                highlight-first
                min-width="16rem"
                @commit="onAutoCategory"
              />
            </div>
          </div>

          <hr class="payee-settings__rule" />

          <p class="payee-settings__rules-title">
            <RichText
              :text="
                t('app.payeeSettingsRenameRules', { name: escapeRichText(displayName(single)) })
              "
            />
          </p>
          <div v-for="(r, i) in rules" :key="i" class="payee-settings__rule-row">
            <select
              v-model="r.op"
              class="payee-settings__op"
              :aria-label="t('app.payeeSettingsRenameRules', { name: displayName(single) })"
              :disabled="!canEdit"
              @change="scheduleSave"
            >
              <option v-for="o in OPS" :key="o.op" :value="o.op">{{ t(o.key) }}</option>
            </select>
            <input
              v-model="r.value"
              class="payee-settings__value"
              type="text"
              data-rule-value
              :aria-label="t(OPS.find((o) => o.op === r.op)?.key ?? 'app.payeeSettingsContains')"
              :disabled="!canEdit"
              @blur="scheduleSave"
            />
            <button
              type="button"
              class="payee-settings__icon"
              :disabled="!canEdit"
              :aria-label="t('app.payeeSettingsCancel')"
              @click="removeRule(i)"
            >
              <Minus aria-hidden="true" />
            </button>
            <button
              v-if="i === rules.length - 1"
              type="button"
              class="payee-settings__icon"
              :disabled="!canEdit || lastRuleBlank"
              :aria-label="t('app.payeeSettingsAddRule')"
              @click="addRule"
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          <p
            v-if="(rulesQ.data.value?.otherRuleIds ?? []).length > 0"
            class="payee-settings__other"
          >
            <UiLink
              v-for="rid in rulesQ.data.value?.otherRuleIds ?? []"
              :key="rid"
              @click="editRule(rid)"
              >{{ t('app.payeeSettingsOtherRule') }}</UiLink
            >
          </p>
          <div class="payee-settings__rule-actions">
            <UiLink v-if="rules.length === 0" :disabled="!canEdit" @click="addRule">{{
              t('app.payeeSettingsAddRule')
            }}</UiLink>
            <UiSmallButton v-else :disabled="!canEdit || lastRuleBlank" @click="renameExisting">
              {{ t('app.payeeSettingsRenameExisting') }}
            </UiSmallButton>
          </div>

          <hr class="payee-settings__rule" />

          <div class="payee-settings__row" data-payee-rules>
            <UiLink v-if="associated > 0" @click="showRules"
              ><strong>{{
                t('app.payeeSettingsAssociatedRules', { n: associated }, associated)
              }}</strong></UiLink
            >
            <UiSmallButton v-else :disabled="!canEdit" @click="createRule">
              {{ t('app.rulesCreate') }}
            </UiSmallButton>
          </div>
        </template>

        <template v-else>
          <p class="payee-settings__multi">
            {{ t('app.payeeSettingsMultiple', { n: selectedPayees.length }) }}
          </p>
          <p class="payee-settings__names">
            {{ selectedPayees.map((p) => `'${displayName(p)}'`).join(', ') }}
          </p>
          <h3 class="payee-settings__section">
            {{ t('app.payeeSettingsCombine') }}
            <Info
              v-tooltip="t('app.payeeSettingsCombineInfo')"
              class="payee-settings__info"
              :aria-label="t('app.payeeSettingsCombineInfo')"
            />
          </h3>
          <div class="payee-settings__row">
            <label>
              {{ t('app.payeeSettingsNewName') }}
              <input
                v-model="combineName"
                class="payee-settings__value"
                type="text"
                :disabled="!canEdit"
              />
            </label>
            <UiSmallButton :disabled="!canEdit || combineName.trim() === ''" @click="combine">
              {{ t('app.payeeSettingsCombineNow') }}
            </UiSmallButton>
          </div>
          <h3 class="payee-settings__section">
            {{ t('app.payeeSettingsListSelected') }}
            <Info
              v-tooltip="t('app.payeeSettingsListInfo')"
              class="payee-settings__info"
              :aria-label="t('app.payeeSettingsListInfo')"
            />
          </h3>
          <div class="payee-settings__row">
            <UiSmallButton :disabled="!canEdit" @click="setEnabled([...selected], false)">
              {{ t('app.payeeSettingsDisableSelected') }}
            </UiSmallButton>
            <UiSmallButton :disabled="!canEdit" @click="setEnabled([...selected], true)">
              {{ t('app.payeeSettingsEnableSelected') }}
            </UiSmallButton>
          </div>
        </template>
      </div>
    </div>
    <template #footer>
      <span class="payee-settings__footer-label">{{ t('app.payeeSettingsAutocompleteAll') }}</span>
      <label v-tooltip="t('app.payeeSettingsCategoryTooltip')" class="payee-settings__check">
        <input
          type="checkbox"
          :checked="settings.app.autofillCategory"
          @change="setPref('autofillCategory', $event)"
        />
        {{ t('app.prefsAutofillCategory') }}
      </label>
      <label v-tooltip="t('app.payeeSettingsNotesTooltip')" class="payee-settings__check">
        <input
          type="checkbox"
          :checked="settings.app.autofillNotes"
          @change="setPref('autofillNotes', $event)"
        />
        {{ t('app.prefsAutofillNotes') }}
      </label>
      <label v-tooltip="t('app.payeeSettingsAmountTooltip')" class="payee-settings__check">
        <input
          type="checkbox"
          :checked="settings.app.autofillAmount"
          @change="setPref('autofillAmount', $event)"
        />
        {{ t('app.prefsAutofillAmount') }}
      </label>
      <span class="payee-settings__spacer" />
      <UiButton primary @click="close">{{ t('app.payeeSettingsClose') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.payee-settings {
  display: grid;
  grid-template-columns: 18rem minmax(0, 1fr);
  gap: var(--space-5);
  height: 100%;
  min-height: 28rem;
}

.payee-settings__list-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.payee-settings__filter,
.payee-settings__value,
.payee-settings__name-input,
.payee-settings__op {
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}

.payee-settings__list {
  flex: 1;
  margin: 0;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--register-border);
  list-style: none;
}

.payee-settings__item {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-2);
  cursor: default;
}

.payee-settings__item.is-selected {
  background: var(--row-selected);
}

.payee-settings__box {
  flex: none;
  width: var(--icon-sm);
  height: var(--icon-sm);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
}

.payee-settings__box.is-checked {
  border-color: var(--accent-blue);
  background: var(--accent-blue);
}

.payee-settings__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payee-settings__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  overflow: auto;
}

.payee-settings__empty {
  color: var(--text-subtle);
}

.payee-settings__title-row,
.payee-settings__row,
.payee-settings__rule-row,
.payee-settings__rule-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.payee-settings__rule-actions {
  justify-content: flex-end;
}

.payee-settings__title {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-strong);
  font-size: var(--font-xl);
  text-align: left;
  cursor: pointer;
}

.payee-settings__multi {
  margin: 0;
  color: var(--accent-blue);
  font-size: var(--font-xl);
  font-weight: 700;
}

.payee-settings__names {
  max-height: 9em;
  margin: 0;
  overflow: hidden;
  line-height: 1.5;
}

.payee-settings__section {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: var(--space-3) 0 0;
  font-size: var(--font-md);
}

.payee-settings__check {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
}

.payee-settings__info {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--text-muted);
}

.payee-settings__rule {
  width: 100%;
  margin: 0;
  border: 0;
  border-top: 1px solid var(--register-border);
}

.payee-settings__category {
  flex: 1;
  min-width: 16rem;
}

.payee-settings__op {
  width: 10.5rem;
}

.payee-settings__value {
  flex: 1;
}

.payee-settings__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 1px solid var(--register-border);
  border-radius: 50%;
  background: var(--button-bg);
  color: var(--text);
  cursor: pointer;
}

.payee-settings__other {
  display: flex;
  flex-direction: column;
  margin: 0;
  color: var(--text-muted);
  font-style: italic;
}

.payee-settings__rules-title {
  margin: 0;
}

.payee-settings__footer-label {
  font-weight: 600;
}

.payee-settings__spacer {
  flex: 1;
}
</style>
