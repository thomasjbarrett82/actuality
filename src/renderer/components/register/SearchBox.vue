<script setup lang="ts">
// The register search box (10 §3–4): "Search {account}", growing while focused or filtering, with a
// drop-down of filter-token suggestions (27 rem wide, up to 20 rows, then it scrolls). Enter or comma
// commits a token; Esc clears an applied search, otherwise cancels (clearing the date filter too).
import { autoUpdate, computePosition, flip, offset, size } from '@floating-ui/dom';
import { categoryLabel } from '@shared/domain/categories';
import { X } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { dateLocale } from '../../i18n';
import { useTags } from '../../queries/budget-data';
import { applySuggestion, quotedSearch, suggestions } from '../../register/search';
import { useRegister } from '../../register/use-register';
import { ALL_DATES } from '../../register/view-state';
import RichText from '../common/RichText.vue';

const { t } = useI18n();
const reg = useRegister();
const tags = useTags();
const id = useId();
const input = ref<HTMLInputElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const open = ref(false);
const active = ref(-1);
const focused = ref(false);

const prompt = computed(() =>
  reg.isAll
    ? t('app.regSearchAll')
    : t('app.regSearchPrompt', { account: reg.account?.name ?? '' }),
);
const expanded = computed(() => focused.value || reg.filtered);

const list = computed(() =>
  suggestions(reg.searchText, {
    words: reg.words,
    dateFormat: reg.format.dateFormat,
    numberFormat: reg.format.money.numberFormat,
    today: reg.today,
    locale: dateLocale.value,
    allAccounts: reg.isAll,
    accounts: reg.accounts,
    payeeNames: reg.payees.filter((p) => p.enabled && !p.transferAccountId).map((p) => p.name),
    categoryLabels: reg.groups.flatMap((g) => g.categories.map((c) => categoryLabel(g, c))),
    tagNames: (tags.data.value ?? []).map((tag) => tag.tag),
  }),
);
const selectable = computed(() => list.value.flatMap((s, i) => (s.header ? [] : [i])));

async function onFocus(): Promise<void> {
  focused.value = true;
  // Starting a search leaves an open edit by the one rule (11 §1).
  if (reg.editor && !(await reg.settleOpenEdit())) input.value?.blur();
}

function onInput(e: Event): void {
  reg.searchText = (e.target as HTMLInputElement).value;
  active.value = -1;
  show();
}

function show(): void {
  if (open.value) return;
  open.value = true;
  void nextTick(place);
}
function close(): void {
  open.value = false;
  stop?.();
  stop = null;
}

function choose(index: number): void {
  const s = list.value[index];
  if (!s || s.header) return;
  reg.searchText = applySuggestion(reg.searchText, s.value, reg.format.money.numberFormat);
  active.value = -1;
  void nextTick(() => {
    const el = input.value;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  });
}

function commitToken(): void {
  const text = reg.searchText.replace(/\s+$/, '');
  if (text !== '' && !text.endsWith(',')) reg.searchText = `${text}, `;
}

function onKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      e.preventDefault();
      show();
      const order = selectable.value;
      if (order.length === 0) return;
      const at = order.indexOf(active.value);
      const next =
        e.key === 'ArrowDown' ? (at + 1) % order.length : (at - 1 + order.length) % order.length;
      active.value = order[next] ?? -1;
      void nextTick(() =>
        popup.value
          ?.querySelector(`#${CSS.escape(`${id}-s-${String(active.value)}`)}`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
      break;
    }
    case 'Enter':
      e.preventDefault();
      e.stopPropagation();
      if (open.value && active.value !== -1) choose(active.value);
      else commitToken();
      close();
      break;
    case ',':
      if (open.value && active.value !== -1) {
        e.preventDefault();
        choose(active.value);
        close();
      }
      break;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      if (open.value) {
        close();
      } else if (quotedSearch(reg.searchText) !== '') {
        reg.searchText = '';
      } else {
        if (reg.dateFiltered) void reg.setDateFilter(ALL_DATES);
        input.value?.blur();
      }
      break;
  }
}

function onBlur(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && popup.value?.contains(next)) return;
  focused.value = false;
  close();
}

function clear(): void {
  reg.searchText = '';
  input.value?.focus();
}

let stop: (() => void) | null = null;
function place(): void {
  const anchor = input.value;
  const el = popup.value;
  if (!anchor || !el) return;
  stop = autoUpdate(anchor, el, () => {
    void computePosition(anchor, el, {
      placement: 'bottom-end',
      strategy: 'fixed',
      middleware: [
        offset(1),
        flip(),
        size({
          apply({ availableHeight }) {
            el.style.maxHeight = `${String(Math.max(availableHeight - 8, 120))}px`;
          },
        }),
      ],
    }).then(({ x, y }) => {
      el.style.left = `${String(x)}px`;
      el.style.top = `${String(y)}px`;
    });
  });
}
onBeforeUnmount(() => stop?.());

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="search" :class="{ 'is-expanded': expanded }">
    <input
      ref="input"
      class="search__input"
      type="text"
      role="combobox"
      autocomplete="off"
      :value="reg.searchText"
      :placeholder="prompt"
      :aria-label="prompt"
      :aria-expanded="open && list.length > 0"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="open && active !== -1 ? `${id}-s-${active}` : undefined"
      data-register-search
      @focus="onFocus"
      @blur="onBlur"
      @input="onInput"
      @keydown="onKeydown"
      @click="show"
    />
    <button
      v-if="reg.searchText !== ''"
      type="button"
      class="search__clear"
      :aria-label="t('a11y.clearSearch')"
      @click="clear"
    >
      <X class="search__icon" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-show="open && list.length > 0" ref="popup" class="search__popup">
        <div :id="`${id}-list`" role="listbox" :aria-label="prompt">
          <template v-for="(s, i) in list" :key="i">
            <div v-if="s.header" class="search__option is-header" role="presentation">
              <RichText :text="s.html" />
            </div>
            <div
              v-else
              :id="`${id}-s-${i}`"
              class="search__option"
              role="option"
              tabindex="-1"
              :aria-selected="i === active"
              @mousedown.prevent="choose(i)"
            >
              <RichText :text="s.html" />
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.search {
  position: relative;
  display: flex;
  flex: 0 1 15rem;
  align-items: center;
  min-width: 15rem;
  transition:
    flex-basis 300ms ease,
    min-width 300ms ease;
}

.search.is-expanded {
  flex: 1 1 100%;
  min-width: 23rem;
}

.search__input {
  width: 100%;
  min-height: max(var(--control-h), var(--hit-min));
  padding: 0 calc(var(--hit-min) + var(--space-1)) 0 var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
}

.search__clear {
  position: absolute;
  right: var(--space-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.search__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.search__popup {
  position: fixed;
  width: 27rem;
  max-height: calc(20 * var(--row-h));
  overflow: auto;
  border: 1px solid var(--tooltip-border);
  background: var(--panel-bg);
  color: var(--text);
  box-shadow: 0 0.3rem 1rem color-mix(in srgb, var(--overlay-shadow) 40%, transparent);
  z-index: 96;
}

.search__option {
  display: flex;
  align-items: center;
  min-height: var(--row-h);
  padding: 0 var(--space-3);
  cursor: default;
}

.search__option.is-header {
  color: var(--text-subtle);
  font-weight: 700;
}

.search__option[aria-selected='true'] {
  background: var(--accent-blue);
  color: var(--panel-bg);
}
</style>
