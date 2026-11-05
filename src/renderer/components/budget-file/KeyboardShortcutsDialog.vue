<script setup lang="ts">
// Keyboard Shortcuts (06 §6.1): the shortcuts by area, from `?` or Help ▸ Keyboard Shortcuts. A filter
// field narrows the list by what a shortcut does or by its keys. Ctrl shows as ⌘ on macOS.
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { SHORTCUT_SECTIONS, type KeyToken, type Shortcut } from '../../keyboard/shortcut-list';
import StandardDialog from '../common/StandardDialog.vue';
import UiButton from '../common/UiButton.vue';

const emit = defineEmits<{ close: [result: null] }>();
const { t } = useI18n();
const id = useId();
const mac = window.app.shell.platform === 'darwin';
const filter = ref('');

function keyText(k: KeyToken): string {
  switch (k) {
    case 'mod':
      return mac ? '⌘' : t('shortcuts.keyCtrl');
    case 'ctrl':
      return mac ? '⌃' : t('shortcuts.keyCtrl');
    case 'shift':
      return t('shortcuts.keyShift');
    case 'alt':
      return mac ? t('shortcuts.keyOption') : t('shortcuts.keyAlt');
    case 'enter':
      return t('shortcuts.keyEnter');
    case 'tab':
      return t('shortcuts.keyTab');
    case 'esc':
      return t('shortcuts.keyEsc');
    case 'delete':
      return t('shortcuts.keyDelete');
    case 'numPlus':
      return t('shortcuts.keyNumPlus');
    default:
      return k;
  }
}

const keysOf = (s: Shortcut): Shortcut['keys'] => (mac && s.macKeys) || s.keys;

const matches = (s: Shortcut, q: string): boolean =>
  t(s.label).toLowerCase().includes(q) ||
  keysOf(s).some((combo) => combo.map(keyText).join('+').toLowerCase().includes(q));

const sections = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return SHORTCUT_SECTIONS.map((s) => ({
    title: s.title,
    items: q ? s.items.filter((i) => matches(i, q)) : s.items,
  })).filter((s) => s.items.length > 0);
});
</script>

<template>
  <StandardDialog
    :title="t('menu.keyboardShortcuts')"
    width="lg"
    height="36rem"
    @cancel="emit('close', null)"
    @submit="emit('close', null)"
  >
    <div class="shortcuts__filter-row">
      <input
        v-model="filter"
        class="shortcuts__filter"
        type="search"
        :placeholder="t('shortcuts.filter')"
        :aria-label="t('shortcuts.filter')"
      />
    </div>
    <p v-if="sections.length === 0" class="shortcuts__empty" role="status">
      {{ t('shortcuts.noMatch') }}
    </p>
    <section v-for="(s, si) in sections" :key="s.title" class="shortcuts__section">
      <h3 :id="`${id}-${si}`" class="shortcuts__heading">{{ t(s.title) }}</h3>
      <table class="shortcuts__table" :aria-labelledby="`${id}-${si}`">
        <tbody>
          <tr v-for="item in s.items" :key="item.label">
            <th scope="row" class="shortcuts__label">{{ t(item.label) }}</th>
            <td class="shortcuts__keys">
              <template v-for="(combo, ci) in keysOf(item)" :key="ci">
                <span v-if="ci > 0" class="shortcuts__or">{{ ` ${t('shortcuts.or')} ` }}</span>
                <span class="shortcuts__combo">
                  <template v-for="(k, ki) in combo" :key="ki">
                    <span v-if="ki > 0" aria-hidden="true">+</span>
                    <kbd class="shortcuts__key">{{ keyText(k) }}</kbd>
                  </template>
                </span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <template #footer>
      <UiButton primary @click="emit('close', null)">{{ t('taskDialog.CloseLabel') }}</UiButton>
    </template>
  </StandardDialog>
</template>

<style scoped>
/* The filter stays in view while the list scrolls under it (the content's own padding is cancelled). */
.shortcuts__filter-row {
  position: sticky;
  top: calc(-1 * var(--space-6));
  margin-top: calc(-1 * var(--space-6));
  padding: var(--space-6) 0 var(--space-3);
  background: var(--panel-bg);
}

.shortcuts__filter {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}

.shortcuts__empty {
  margin: var(--space-3) 0;
  color: var(--text-muted);
}

.shortcuts__section + .shortcuts__section {
  margin-top: var(--space-5);
}

.shortcuts__heading {
  margin: 0 0 var(--space-2);
  font-size: var(--font-md);
  font-weight: 600;
}

.shortcuts__table {
  width: 100%;
  border-collapse: collapse;
}

.shortcuts__table tr {
  border-bottom: 1px solid var(--grid-line-h);
}

.shortcuts__label,
.shortcuts__keys {
  padding: var(--space-2) 0;
  vertical-align: middle;
}

.shortcuts__label {
  font-weight: normal;
  text-align: start;
}

.shortcuts__keys {
  text-align: end;
  white-space: nowrap;
}

.shortcuts__combo {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
}

.shortcuts__or {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.shortcuts__key {
  display: inline-block;
  min-width: 1.5em;
  padding: 0 var(--space-2);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--row-alt-even);
  color: var(--text);
  font: inherit;
  font-size: var(--font-sm);
  text-align: center;
}
</style>
