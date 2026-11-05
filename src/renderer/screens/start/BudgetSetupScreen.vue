<script setup lang="ts">
// Budget Setup / Budget Properties (07 §4). Setup creates a budget from a starting template with the
// chosen formats; Properties shows the open budget's name and formats and saves changes, renaming it on
// the server too, and the first day of the week. Its end-to-end encryption section enables encryption or
// replaces the key as a separate action (03 §7). Properties stays viewable offline, read-only, with only
// Close (03 §5.3).
import type { WeekDay } from '@shared/budget-format';
import { DATE_FORMATS, type DateFormat } from '@shared/dates';
import {
  dateFormatExample,
  defaultCurrency,
  defaultDateFormat,
  defaultNumberFormat,
  NUMBER_FORMAT_EXAMPLES,
} from '@shared/locale-defaults';
import { NUMBER_FORMATS, type NumberFormat } from '@shared/money';
import type {
  BudgetFormats,
  BudgetPropertiesPatch,
  EncryptionKeyResult,
} from '@shared/rpc/host-api';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { format as formatDate } from 'date-fns';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { translatedTemplate } from '../../budget-templates';
import UiButton from '../../components/common/UiButton.vue';
import EncryptionKeyDialog from '../../components/session/EncryptionKeyDialog.vue';
import { dateLocale } from '../../i18n';
import { keyboard } from '../../keyboard/dispatcher';
import { errorInfo } from '../../rpc/errors';
import { host } from '../../rpc/host-client';
import { createBudget, leaveStartScreen, showUnexpected } from '../../session';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useSettings } from '../../stores/settings';
import { useStart, type TemplateId } from '../../stores/start';

const { t, locale } = useI18n();
const start = useStart();
const settings = useSettings();
const connection = useConnection();
const queryClient = useQueryClient();

const creating = computed(() => start.screen === 'setup');
const osLocale = navigator.language || 'en-US';

interface SetupForm {
  name: string;
  template: TemplateId;
  currency: string;
  numberFormat: NumberFormat | '';
  dateFormat: DateFormat | '';
  hideFraction: boolean;
}
const form = reactive<SetupForm>({
  name: '',
  template: 'personal',
  currency: '',
  numberFormat: '',
  dateFormat: '',
  hideFraction: false,
});
const error = ref<string | null>(null);
const saving = ref(false);
/** Properties only. An unset pref shows the UI locale's week start and isn't written unless changed. */
const localeWeekStart = computed((): WeekDay => dateLocale.value.options?.weekStartsOn ?? 0);
const firstDayOfWeek = ref<WeekDay>(0);

const propertiesKey = computed(() => [
  'prefs',
  'budgetProperties',
  connection.info.budget?.cloudFileId,
]);
const props = useQuery({
  queryKey: propertiesKey,
  queryFn: () => host.call('budgetFile.properties', {}),
  enabled: () => !creating.value,
  retry: false,
});
/** The budget's own values, to send only what changed. */
const original = computed(() => props.data.value);

onMounted(() => {
  if (!creating.value) return;
  const draft = start.setupDraft;
  const app = settings.app;
  Object.assign(form, {
    name: draft?.name ?? t('app.setupDefaultName'),
    template: draft?.template ?? 'personal',
    currency: draft?.currency ?? app.lastPickedCurrency ?? defaultCurrency(osLocale),
    numberFormat:
      draft?.numberFormat ?? app.lastPickedNumberFormat ?? defaultNumberFormat(osLocale),
    dateFormat: draft?.dateFormat ?? app.lastPickedDateFormat ?? defaultDateFormat(osLocale),
    hideFraction: draft?.hideFraction ?? false,
  });
  error.value = start.setupError;
  start.setupError = null;
});
watch(
  original,
  (p) => {
    if (!p || creating.value) return;
    Object.assign(form, p);
    firstDayOfWeek.value = p.firstDayOfWeek ?? localeWeekStart.value;
  },
  { immediate: true },
);
watch(
  () => props.error.value,
  (e) => {
    if (e) void showUnexpected(e);
  },
);

/** Properties of a budget that can't be changed now: offline, or still loading (03 §5.3). */
const readOnly = computed(() => !creating.value && (!connection.canEdit || !original.value));
const nameLockedReason = computed(() => {
  const p = original.value;
  if (creating.value || !p) return null;
  if (p.shared) return t('app.noPermission');
  if (!p.renameAvailable) return t('app.setupRenameUnavailable');
  return null;
});

const encryptionStatus = computed(() => {
  switch (original.value?.encryption) {
    case 'enabled':
      return t('app.propertiesEncryptionEnabled');
    case 'disabled':
      return t('app.propertiesEncryptionDisabled');
    default:
      return t('app.propertiesEncryptionUnknown');
  }
});
/** The encryption action needs a server budget open online whose status is known (07 §4). */
const encryptionAction = computed(() => {
  const p = original.value;
  if (creating.value || readOnly.value || !p || p.encryption === 'unknown') return null;
  return p.encryption === 'enabled' ? 'replace' : 'enable';
});
const encryptionDialog = ref(false);

async function encryptionDone(result: EncryptionKeyResult): Promise<void> {
  encryptionDialog.value = false;
  await queryClient.invalidateQueries({ queryKey: propertiesKey.value });
  // The key change worked; only saving or deleting the remembered password didn't (03 §7).
  const warning = result.rememberFailed
    ? {
        instruction: t('app.encryptionKeyRememberFailedTitle'),
        content: t('app.encryptionKeyRememberFailed'),
      }
    : result.forgetFailed
      ? {
          instruction: t('app.encryptionKeyForgetFailedTitle'),
          content: t('app.encryptionKeyForgetFailed'),
        }
      : null;
  if (warning)
    await useDialogs().showTaskDialog({ ...warning, icon: 'warning', buttons: ['close'] });
}

async function encryptionCancelled(): Promise<void> {
  encryptionDialog.value = false;
  // A failed attempt may still have changed the server (03 §7): show what it holds now.
  await queryClient.invalidateQueries({ queryKey: propertiesKey.value });
}

const currencies = computed(() => {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale.value, 'en'], { type: 'currency' });
  } catch {
    names = null;
  }
  const options = Intl.supportedValuesOf('currency').map((code) => ({
    code,
    label: t('app.setupCurrencyOption', { name: names?.of(code) ?? code, code }),
  }));
  return options.sort((a, b) => a.label.localeCompare(b.label, locale.value));
});
/** "No currency" is offered only for a budget that has none, so saving keeps it (04 §3). */
const offerNoCurrency = computed(() => !creating.value && original.value?.currency === '');

/** Sunday through Saturday, in the UI language (07 §4). 2023-01-01 was a Sunday. */
const weekdays = computed(() =>
  ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({
    value: day,
    label: formatDate(new Date(2023, 0, 1 + day), 'EEEE', { locale: dateLocale.value }),
  })),
);

const numberFormats = NUMBER_FORMATS.map((f) => ({ value: f, label: NUMBER_FORMAT_EXAMPLES[f] }));
const dateFormats = computed(() =>
  DATE_FORMATS.map((f) => ({
    value: f,
    label: t('app.setupDateFormatOption', dateFormatExample(f)),
  })),
);

/** The first problem, in the order the fields appear (07 §4). Stops on the first error. */
function validate(): string | null {
  if (!form.name.trim()) return t('app.setupNameRequired');
  if ((creating.value && !form.currency) || !form.numberFormat)
    return t('app.setupCurrencyRequired');
  if (!form.dateFormat) return t('app.setupDateRequired');
  return null;
}

function formats(): BudgetFormats | null {
  if (!form.numberFormat || !form.dateFormat) return null;
  return {
    currency: form.currency,
    numberFormat: form.numberFormat,
    dateFormat: form.dateFormat,
    hideFraction: form.hideFraction,
  };
}

async function duplicateName(name: string): Promise<boolean> {
  const list = await host.call('session.listBudgets', {}).catch(() => []);
  return list.some((b) => b.name === name);
}

async function submit(): Promise<void> {
  if (saving.value || readOnly.value) return;
  error.value = validate();
  const f = formats();
  if (error.value || !f) return;
  const name = form.name.trim();
  saving.value = true;
  try {
    if (creating.value) {
      if (await duplicateName(name)) {
        error.value = t('app.setupDuplicateName', { name });
        return;
      }
      start.setupDraft = { ...f, name, template: form.template };
      await createBudget(
        name,
        translatedTemplate(form.template, (k) => t(k)),
        f,
      );
    } else {
      await save(name, f);
    }
  } finally {
    saving.value = false;
  }
}

async function save(name: string, f: BudgetFormats): Promise<void> {
  const before = original.value;
  if (!before) return;
  const patch: BudgetPropertiesPatch = {};
  if (name !== before.name && !nameLockedReason.value) patch.name = name;
  for (const key of ['currency', 'numberFormat', 'dateFormat', 'hideFraction'] as const) {
    if (f[key] !== before[key]) Object.assign(patch, { [key]: f[key] });
  }
  if (firstDayOfWeek.value !== (before.firstDayOfWeek ?? localeWeekStart.value))
    patch.firstDayOfWeek = firstDayOfWeek.value;
  try {
    if (Object.keys(patch).length > 0) await host.call('budgetFile.updateProperties', patch);
    await queryClient.invalidateQueries({ queryKey: propertiesKey.value });
    leaveStartScreen();
  } catch (e) {
    const info = errorInfo(e);
    await queryClient.invalidateQueries({ queryKey: propertiesKey.value });
    if (info.code === 'offline') {
      await useDialogs().showTaskDialog({
        instruction: t('app.offlineTitle'),
        content: t('app.offlineMessage'),
        icon: 'warning',
        buttons: ['close'],
      });
    } else if (info.detail === 'internal-handler-unavailable') {
      error.value = t('app.setupRenameUnavailable');
    } else {
      await showUnexpected(e);
    }
  }
}

function cancel(): void {
  start.setupDraft = null;
  leaveStartScreen();
}

// Esc is Cancel (07 §4).
const popKeys = keyboard.push((e) => {
  if (e.key !== 'Escape') return false;
  cancel();
  return true;
});
onBeforeUnmount(popKeys);
</script>

<template>
  <section class="setup" aria-labelledby="setup-title">
    <h1 id="setup-title" class="setup__title">
      {{ creating ? t('app.setupTitle') : t('app.propertiesTitle') }}
    </h1>
    <form class="setup__form" novalidate @submit.prevent="submit">
      <label class="setup__label" for="setup-name">{{ t('app.setupBudgetName') }}</label>
      <input
        id="setup-name"
        v-model="form.name"
        v-tooltip="nameLockedReason ?? undefined"
        class="input"
        type="text"
        spellcheck="false"
        :readonly="nameLockedReason !== null"
        :disabled="readOnly"
        :aria-invalid="error === t('app.setupNameRequired') ? 'true' : undefined"
        :aria-describedby="error ? 'setup-error' : undefined"
      />

      <template v-if="creating">
        <fieldset class="setup__group">
          <legend class="setup__label">{{ t('app.setupStartingCategories') }}</legend>
          <p class="setup__hint">{{ t('app.setupStartingCategoriesHint') }}</p>
          <label class="check">
            <input v-model="form.template" type="radio" name="template" value="personal" />
            {{ t('app.setupTemplatePersonal') }}
          </label>
          <label class="check">
            <input v-model="form.template" type="radio" name="template" value="business" />
            {{ t('app.setupTemplateBusiness') }}
          </label>
        </fieldset>
      </template>

      <fieldset class="setup__group">
        <legend class="setup__label">{{ t('app.setupFormats') }}</legend>
        <div class="setup__grid">
          <label for="setup-currency">{{ t('app.setupCurrency') }}</label>
          <select id="setup-currency" v-model="form.currency" class="input" :disabled="readOnly">
            <option v-if="offerNoCurrency" value="">{{ t('app.setupCurrencyNone') }}</option>
            <option v-else value="" disabled hidden />
            <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.label }}</option>
          </select>
          <label for="setup-number">{{ t('app.setupWhichFormat') }}</label>
          <select id="setup-number" v-model="form.numberFormat" class="input" :disabled="readOnly">
            <option value="" disabled hidden />
            <option v-for="f in numberFormats" :key="f.value" :value="f.value">
              {{ f.label }}
            </option>
          </select>
          <label for="setup-date">{{ t('app.setupDateFormat') }}</label>
          <select id="setup-date" v-model="form.dateFormat" class="input" :disabled="readOnly">
            <option value="" disabled hidden />
            <option v-for="f in dateFormats" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
          <span />
          <label class="check">
            <input v-model="form.hideFraction" type="checkbox" :disabled="readOnly" />
            {{ t('app.setupHideDecimals') }}
          </label>
          <template v-if="!creating">
            <label for="setup-week">{{ t('app.setupFirstDayOfWeek') }}</label>
            <select id="setup-week" v-model="firstDayOfWeek" class="input" :disabled="readOnly">
              <option v-for="d in weekdays" :key="d.value" :value="d.value">{{ d.label }}</option>
            </select>
          </template>
        </div>
      </fieldset>

      <fieldset v-if="!creating" class="setup__group">
        <legend class="setup__label">{{ t('app.propertiesEncryption') }}</legend>
        <div class="setup__encryption">
          <span>{{ encryptionStatus }}</span>
          <UiButton
            v-if="encryptionAction"
            v-tooltip="
              original?.encryptionKeyAvailable ? undefined : t('app.encryptionKeyUnavailable')
            "
            :disabled="!original?.encryptionKeyAvailable"
            @click="encryptionDialog = true"
          >
            {{
              encryptionAction === 'replace'
                ? t('app.propertiesEncryptionReplace')
                : t('app.propertiesEncryptionEnable')
            }}
          </UiButton>
        </div>
      </fieldset>

      <p v-if="error" id="setup-error" class="setup__error" role="alert">{{ error }}</p>

      <div class="setup__buttons">
        <template v-if="creating || !readOnly">
          <UiButton @click="cancel">{{ t('taskDialog.CancelLabel') }}</UiButton>
          <UiButton type="submit" primary :disabled="saving">
            {{ creating ? t('app.setupCreate') : t('app.setupSave') }}
          </UiButton>
        </template>
        <UiButton v-else @click="cancel">{{ t('taskDialog.CloseLabel') }}</UiButton>
      </div>
    </form>
    <EncryptionKeyDialog
      v-if="encryptionDialog"
      :name="original?.name ?? form.name"
      :replace="encryptionAction === 'replace'"
      @cancel="encryptionCancelled"
      @done="encryptionDone"
    />
  </section>
</template>

<style scoped>
.setup {
  display: grid;
  grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr);
  gap: var(--space-7);
  align-items: start;
}

.setup__title {
  margin: 0;
  font-size: var(--font-2xl);
  font-weight: 400;
  line-height: 1.1;
  white-space: pre-line;
}

.setup__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 36rem;
}

.setup__label {
  font-size: var(--font-md);
  font-weight: 600;
}

.setup__hint {
  margin: 0 0 var(--space-2);
  font-size: var(--font-sm);
}

.setup__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-3) 0 0;
  padding: 0;
  border: 0;
}

.setup__grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-3) var(--space-4);
  align-items: center;
}

.input {
  min-height: var(--hit-min);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font-size: var(--font-md);
}

.input:read-only:not(select) {
  background: var(--register-gray-bg);
}

.check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.setup__encryption {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

.setup__error {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
}

.setup__buttons {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
  margin-top: var(--space-4);
}
</style>
