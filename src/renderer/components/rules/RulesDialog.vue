<script setup lang="ts">
// The Rules dialog (23 §2): every rule in Actual's run order, with its stage and text, a text filter and
// an optional payee filter. A row opens the rule editor; checked rows can be deleted. Offline it is
// read-only.
import { isAssociated, type Rule } from '@shared/domain/rules';
import type { Id } from '@shared/domain/types';
import { X } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePayees, useRules } from '../../queries/budget-data';
import { attempt } from '../../register/dialogs';
import { host } from '../../rpc/host-client';
import { openRuleEditor } from '../../rules/editor';
import { emptyForm, formForPayee, formOf } from '../../rules/form';
import { ruleText } from '../../rules/text';
import { useRuleData } from '../../rules/use-rules';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const props = defineProps<{ payeeId: Id | null }>();
const emit = defineEmits<{ close: [result: null] }>();
const { t } = useI18n();
const connection = useConnection();
const dialogs = useDialogs();
const rulesQ = useRules();
const payeesQ = usePayees();
const { text, payeeName } = useRuleData();

const payeeId = ref<Id | null>(props.payeeId);
const payee = computed(() => (payeesQ.data.value ?? []).find((p) => p.id === payeeId.value));
const filter = ref('');

const rows = computed(() =>
  (rulesQ.data.value ?? []).map((rule) => ({ rule, text: ruleText(text.value, rule) })),
);
const listed = computed(() => {
  const f = filter.value.trim().toLocaleLowerCase();
  return rows.value.filter(
    (r) =>
      (payeeId.value === null || isAssociated(r.rule, payeeId.value)) &&
      (f === '' || r.text.toLocaleLowerCase().includes(f)),
  );
});

const stageText = (r: Rule): string =>
  r.schedule
    ? t('app.rulesStageSchedule')
    : r.stage === 'pre'
      ? t('app.rulesStagePre')
      : r.stage === 'post'
        ? t('app.rulesStagePost')
        : t('app.rulesStageDefault');

const checked = ref<Set<Id>>(new Set());
const checkedListed = computed(() => listed.value.filter((r) => checked.value.has(r.rule.id)));
function toggle(id: Id): void {
  const next = new Set(checked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  checked.value = next;
}

async function open(rule: Rule): Promise<void> {
  await openRuleEditor(formOf(rule));
}

async function create(): Promise<void> {
  await openRuleEditor(payeeId.value ? formForPayee(payeeId.value) : emptyForm());
}

async function remove(): Promise<void> {
  const ids = checkedListed.value.map((r) => r.rule.id);
  if (ids.length === 0) return;
  const { button } = await dialogs.showTaskDialog({
    instruction: t('app.rulesDeleteConfirm', { n: ids.length }, ids.length),
    content: t('app.rulesDeleteContent'),
    icon: 'warning',
    buttons: [{ id: 'delete', label: t('app.rulesDeleteButton'), isDefault: true }, 'cancel'],
  });
  if (button !== 'delete') return;
  const result = await attempt(() => host.call('rules.delete', { ids }));
  if (result.ok) checked.value = new Set();
}
</script>

<template>
  <StandardDialog
    :title="t('app.rulesTitle')"
    width="xl"
    height="39rem"
    @cancel="emit('close', null)"
    @submit="emit('close', null)"
  >
    <div class="rules" data-rules-dialog>
      <div class="rules__bar">
        <input
          v-model="filter"
          class="rules__filter"
          type="search"
          :placeholder="t('app.rulesFilter')"
          :aria-label="t('app.rulesFilter')"
        />
        <span v-if="payeeId" class="rules__chip" data-payee-filter>
          {{
            t('app.rulesPayeeFilter', { name: payee ? payeeName(payee) : t('app.rulesDeleted') })
          }}
          <button
            type="button"
            class="rules__chip-remove"
            :aria-label="t('app.rulesRemovePayeeFilter')"
            @click="payeeId = null"
          >
            <X aria-hidden="true" />
          </button>
        </span>
      </div>
      <div class="rules__table" role="table" :aria-label="t('app.rulesTitle')">
        <div class="rules__row rules__row--head" role="row">
          <span role="columnheader"
            ><span class="visually-hidden">{{ t('app.rulesSelect') }}</span></span
          >
          <span role="columnheader">{{ t('app.rulesStageHeader') }}</span>
          <span role="columnheader">{{ t('app.rulesRuleHeader') }}</span>
        </div>
        <div
          v-for="r in listed"
          :key="r.rule.id"
          class="rules__row"
          role="row"
          :data-rule-id="r.rule.id"
        >
          <span role="cell">
            <input
              v-if="!r.rule.schedule"
              type="checkbox"
              :checked="checked.has(r.rule.id)"
              :disabled="!connection.canEdit"
              :aria-label="t('app.rulesSelect')"
              @change="toggle(r.rule.id)"
            />
            <span v-else class="visually-hidden">{{ t('app.rulesScheduleNoDelete') }}</span>
          </span>
          <span role="cell" class="rules__stage">{{ stageText(r.rule) }}</span>
          <span role="cell" class="rules__text-cell">
            <button
              v-tooltip="r.text"
              type="button"
              class="rules__text"
              data-rule-text
              @click="open(r.rule)"
            >
              {{ r.text }}
            </button>
          </span>
        </div>
      </div>
      <p v-if="listed.length === 0" class="rules__empty" role="status">
        {{ rows.length === 0 ? t('app.rulesNone') : t('app.rulesNoMatch') }}
      </p>
    </div>
    <template #footer>
      <UiButton v-if="checkedListed.length > 0" :disabled="!connection.canEdit" @click="remove">{{
        t('app.rulesDelete', { n: checkedListed.length }, checkedListed.length)
      }}</UiButton>
      <span class="rules__spacer" />
      <UiButton :disabled="!connection.canEdit" @click="create">{{
        t('app.rulesCreate')
      }}</UiButton>
      <UiButton primary @click="emit('close', null)">{{ t('app.rulesClose') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
.rules {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 100%;
  min-height: 28rem;
}

.rules__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.rules__filter {
  width: 18rem;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}

.rules__chip {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  padding: 0 var(--space-1) 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--register-gray-bg);
}

.rules__chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.rules__chip-remove svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.rules__table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--register-border);
}

.rules__row {
  display: grid;
  grid-template-columns: 2rem 6rem minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-2);
}

.rules__row--head {
  position: sticky;
  top: 0;
  background: var(--register-gray-bg);
  font-weight: 600;
}

.rules__stage {
  color: var(--text-subtle);
}

.rules__text-cell {
  min-width: 0;
}

.rules__text {
  width: 100%;
  min-height: var(--hit-min);
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.rules__text:hover {
  text-decoration: underline;
}

.rules__empty {
  margin: 0;
  padding: var(--space-3);
  color: var(--text-subtle);
}

.rules__spacer {
  flex: 1;
}
</style>
