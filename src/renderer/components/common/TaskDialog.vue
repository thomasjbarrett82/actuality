<script setup lang="ts">
// A TaskDialog (17 §1), modelled on the Windows task dialog. Modal: focus is trapped and returns to the
// opener on close (22 §3); keyboard shortcuts are suppressed while it's open (06 §6).
import type { ISODate } from '@shared/domain/types';
import { ArrowRight, CircleHelp, CircleX, Info, TriangleAlert, X } from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { trapFocus } from '../../a11y/focus';
import { keyboard } from '../../keyboard/dispatcher';
import {
  defaultButtonId,
  escClosable,
  type StandardButton,
  type TaskDialogOptions,
  type TaskDialogResult,
} from '../../stores/dialogs';
import AppLogo from './AppLogo.vue';
import DateField from './DateField.vue';
import type { DateFieldApi } from './exposed';
import RichText from './RichText.vue';
import UiButton from './UiButton.vue';

const props = defineProps<{ options: TaskDialogOptions }>();
const emit = defineEmits<{ close: [result: TaskDialogResult] }>();
const { t } = useI18n();
const id = useId();
const root = ref<HTMLElement | null>(null);
const buttonId = (b: string): string => `${id}-btn-${b}`;
const checked = ref(props.options.checkbox?.checked === true);
/** The date field's committed date, and the date its text holds now (null while it isn't valid). */
const date = ref<ISODate | null>(null);
const typed = ref<ISODate | null>(null);
const field = ref<DateFieldApi | null>(null);
const dateReady = computed(() => typed.value !== null);
const disabled = (button: string): boolean =>
  props.options.dateField?.requiredBy === button && !dateReady.value;

const LABEL_KEYS: Record<StandardButton, string> = {
  ok: 'taskDialog.OkLabel',
  cancel: 'taskDialog.CancelLabel',
  close: 'taskDialog.CloseLabel',
  yes: 'taskDialog.YesLabel',
  no: 'taskDialog.NoLabel',
  retry: 'taskDialog.RetryLabel',
};

const buttons = computed(() =>
  props.options.buttons.map((b) =>
    typeof b === 'string' ? { id: b, label: t(LABEL_KEYS[b]) } : b,
  ),
);
const defaultId = computed(() => defaultButtonId(props.options));
const defaultLinkId = computed(
  () =>
    props.options.commandLinks?.find((l) => l.isDefault)?.id ??
    props.options.commandLinks?.[0]?.id ??
    null,
);
const canEsc = computed(() => escClosable(props.options));
const role = computed(() =>
  props.options.icon === 'warning' || props.options.icon === 'error' ? 'alertdialog' : 'dialog',
);
const icon = computed(() => {
  switch (props.options.icon) {
    case 'info':
      return Info;
    case 'help':
      return CircleHelp;
    case 'warning':
      return TriangleAlert;
    case 'error':
      return CircleX;
    case 'logo':
      return AppLogo;
    default:
      return null;
  }
});

function finish(button: string | null): void {
  if (button !== null && props.options.dateField?.requiredBy === button) {
    // The typed text is committed first; an invalid one shows its callout and keeps the dialog open.
    if (!field.value?.commit() || !date.value) return;
    emit('close', { button, checkboxChecked: checked.value, date: date.value });
    return;
  }
  emit('close', { button, checkboxChecked: checked.value });
}

let release: ((fallback?: () => HTMLElement | null) => void) | null = null;
let popScope: (() => void) | null = null;

onMounted(() => {
  const el = root.value;
  if (!el) return;
  const initialId = props.options.commandLinks?.length ? defaultLinkId.value : defaultId.value;
  const initial = props.options.dateField
    ? el.querySelector<HTMLElement>('.task-dialog__date input')
    : initialId
      ? document.getElementById(buttonId(initialId))
      : null;
  release = trapFocus(el, initial);
  popScope = keyboard.push(
    (e) => {
      if (e.key === 'Escape') {
        if (canEsc.value) finish(null);
        return true;
      }
      if (e.key === 'Enter') {
        const target = e.target;
        if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)
          return false;
        if (target instanceof HTMLInputElement && target.type === 'checkbox') return false;
        const chosen = props.options.commandLinks?.length ? defaultLinkId.value : defaultId.value;
        // A disabled default button doesn't run; Enter still commits the date field's text.
        if (chosen !== null && disabled(chosen)) field.value?.commit();
        else finish(chosen);
        return true;
      }
      return false;
    },
    { modal: true },
  );
});

onBeforeUnmount(() => {
  popScope?.();
  release?.(() => document.querySelector<HTMLElement>('[aria-selected="true"], main h1'));
});
</script>

<template>
  <div class="task-backdrop">
    <div
      ref="root"
      class="task-dialog"
      :role="role"
      aria-modal="true"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="options.content ? `${id}-content` : undefined"
    >
      <header v-if="options.title" class="task-dialog__title">
        <span :id="`${id}-label`">{{ options.title }}</span>
        <button
          v-if="canEsc"
          type="button"
          class="task-dialog__close"
          :aria-label="t('taskDialog.CloseLabel')"
          @click="finish(null)"
        >
          <X class="task-dialog__close-icon" aria-hidden="true" />
        </button>
      </header>
      <div class="task-dialog__body">
        <component
          :is="icon"
          v-if="icon"
          class="task-dialog__icon"
          :class="`is-${options.icon}`"
          aria-hidden="true"
        />
        <div class="task-dialog__text">
          <p
            :id="options.title ? `${id}-instruction` : `${id}-label`"
            class="task-dialog__instruction"
          >
            {{ options.instruction }}
          </p>
          <div v-if="options.content" :id="`${id}-content`" class="task-dialog__content">
            <RichText :text="options.content" @link="(e) => finish(`link:${e}`)" />
          </div>
          <div v-if="options.dateField" class="task-dialog__date">
            <DateField
              ref="field"
              :model-value="date"
              :label="options.dateField.label"
              :placeholder="options.dateField.placeholder ?? ''"
              :date-format="options.dateField.dateFormat"
              :today="options.dateField.today"
              @update:model-value="(d) => (date = typed = d)"
              @typed="(d) => (typed = d)"
            />
          </div>
          <div v-if="options.commandLinks?.length" class="task-dialog__links">
            <button
              v-for="link in options.commandLinks"
              :id="buttonId(link.id)"
              :key="link.id"
              type="button"
              class="command-link"
              :class="{ 'is-default': link.id === defaultLinkId }"
              @click="finish(link.id)"
            >
              <span class="command-link__title"
                ><ArrowRight class="command-link__arrow" aria-hidden="true" />{{ link.title }}</span
              >
              <span v-if="link.subLabel" class="command-link__sub">{{ link.subLabel }}</span>
            </button>
          </div>
        </div>
      </div>
      <footer class="task-dialog__footer">
        <label
          v-if="options.checkbox"
          class="task-dialog__checkbox"
          :title="options.checkbox.tooltip"
        >
          <input v-model="checked" type="checkbox" />
          {{ options.checkbox.text }}
        </label>
        <span v-if="options.footer" class="task-dialog__footer-text">{{ options.footer }}</span>
        <span class="task-dialog__spacer" />
        <UiButton
          v-for="b in buttons"
          :id="buttonId(b.id)"
          :key="b.id"
          :primary="b.id === defaultId"
          :disabled="disabled(b.id)"
          @click="finish(b.id)"
        >
          {{ b.label }}
        </UiButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.task-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--overlay-shadow) 45%, transparent);
  z-index: 100;
}

.task-dialog {
  max-width: calc(100vw - 2 * var(--space-6));
  max-height: 90vh;
  overflow: auto;
  background: var(--panel-bg);
  border-radius: var(--radius-sm);
  box-shadow: 0 0.6rem 2rem color-mix(in srgb, var(--overlay-shadow) 60%, transparent);
  color: var(--text);
}

.task-dialog__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--bar-h);
  padding: 0 var(--space-3) 0 var(--space-5);
  background: linear-gradient(var(--callout-bg-start), var(--callout-bg-end));
  border-bottom: 1px solid var(--register-border);
  font-weight: 600;
}

.task-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 0;
  background: transparent;
  cursor: pointer;
}

.task-dialog__body {
  display: flex;
  gap: var(--space-5);
  padding: var(--space-6) var(--space-5);
}

.task-dialog__icon {
  flex: none;
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--accent-blue);
}

.task-dialog__icon.is-error {
  color: var(--error-badge);
}

.task-dialog__icon.is-warning {
  color: var(--needscat-badge);
}

.task-dialog__text {
  width: var(--dialog-text-w);
  max-width: 100%;
}

.task-dialog__instruction {
  margin: 0 0 var(--space-4);
  font-size: var(--font-xl);
  font-weight: 700;
  color: var(--accent-green);
}

.task-dialog__content {
  font-size: var(--font-md);
}

.task-dialog__date {
  max-width: 12rem;
  margin-top: var(--space-5);
}

.task-dialog__links {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-5);
}

.command-link {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: var(--hit-min);
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-subtle);
  text-align: left;
  cursor: pointer;
}

.command-link:hover {
  background: var(--button-bg);
}

.command-link__title {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--font-xl);
  font-weight: 700;
}

.command-link__arrow {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.command-link.is-default .command-link__title {
  color: var(--accent-blue);
}

.command-link__sub {
  padding-left: var(--space-5);
  font-style: italic;
}

.task-dialog__footer {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--register-border);
  background: var(--register-gray-bg);
}

.task-dialog__spacer {
  flex: 1;
}

.task-dialog__checkbox {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.task-dialog__close-icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
