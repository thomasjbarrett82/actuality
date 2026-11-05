<script setup lang="ts">
// The development gallery: every common component, with a switcher for the four palettes
// (05 §1.9). Development builds only; its demo labels aren't translated.
import { INITIAL_CONNECTION, type ConnectionInfo } from '@shared/connection';
import { today as todayOf } from '@shared/dates';
import type { ISODate, Money, Month } from '@shared/domain/types';
import { CalendarClock, Scale } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { prefixFilter, type AutoCompleteEntry } from '../../components/common/autocomplete-list';
import AutoComplete from '../../components/common/AutoComplete.vue';
import CalculatorPanel from '../../components/common/CalculatorPanel.vue';
import { TAILS, type Tail } from '../../components/common/callout-placement';
import Callout from '../../components/common/Callout.vue';
import DateField from '../../components/common/DateField.vue';
import MoneyInput from '../../components/common/MoneyInput.vue';
import MonthPicker from '../../components/common/MonthPicker.vue';
import StandardDialog from '../../components/common/StandardDialog.vue';
import UiButton from '../../components/common/UiButton.vue';
import UiChunkyButton from '../../components/common/UiChunkyButton.vue';
import UiLink from '../../components/common/UiLink.vue';
import UiMenuButton from '../../components/common/UiMenuButton.vue';
import UiSegmented from '../../components/common/UiSegmented.vue';
import UiSmallButton from '../../components/common/UiSmallButton.vue';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useLoadingOverlay } from '../../stores/loading';
import { useSettings } from '../../stores/settings';
import { applyTheme, themeAttributes, type ThemeAttributes } from '../../theme';

const router = useRouter();
const dialogs = useDialogs();
const loading = useLoadingOverlay();
const connection = useConnection();
const settings = useSettings();

type Palette = 'light' | 'dark' | 'light-cvd' | 'dark-cvd';
// Starts from the palette the app is showing.
const html = document.documentElement.dataset;
const palette = ref<Palette>(
  `${html['theme'] === 'dark' ? 'dark' : 'light'}${html['cvd'] === 'on' ? '-cvd' : ''}`,
);
const palettes: { value: Palette; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'light-cvd', label: 'Light CVD' },
  { value: 'dark-cvd', label: 'Dark CVD' },
];
function setPalette(p: Palette): void {
  palette.value = p;
  const attrs: ThemeAttributes = {
    theme: p.startsWith('dark') ? 'dark' : 'light',
    cvd: p.endsWith('cvd') ? 'on' : 'off',
  };
  applyTheme(attrs);
}

const realConnection = connection.info;
const bannerStates: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'offline', label: 'Offline' },
  { value: 'unsynced', label: 'Unsynced' },
  { value: 'signedOut', label: 'Signed out' },
  { value: 'reconnecting', label: 'Reconnecting' },
];
const banner = ref('none');
function setBanner(value: string): void {
  banner.value = value;
  const base: ConnectionInfo = { ...INITIAL_CONNECTION, lastSyncAt: Date.now() - 3_600_000 };
  const states: Record<string, ConnectionInfo> = {
    none: realConnection,
    offline: { ...base, state: 'OfflineReadOnly' },
    unsynced: { ...base, state: 'OfflineReadOnly', unsyncedChanges: true },
    signedOut: { ...base, state: 'OfflineReadOnly', signedOut: true },
    reconnecting: { ...base, state: 'Reconnecting' },
  };
  connection.info = states[value] ?? realConnection;
}

onBeforeUnmount(() => {
  connection.info = realConnection;
  applyTheme(
    themeAttributes(
      settings.app.appearance,
      settings.app.colorVision,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    ),
  );
});

const segmented = ref('budget');
const menuOpen = ref(false);
const lastResult = ref('');

async function taskDialog(kind: 'info' | 'warning' | 'links'): Promise<void> {
  const result =
    kind === 'info'
      ? await dialogs.showTaskDialog({
          title: 'Information',
          instruction: 'Your budget was saved',
          content:
            'Content may use **bold**, *italic*, line breaks\nand <a data-event="more">links</a>.',
          icon: 'info',
          buttons: ['ok'],
          checkbox: { text: "Don't show this again" },
        })
      : kind === 'warning'
        ? await dialogs.showTaskDialog({
            instruction: 'Delete 3 transactions?',
            content: 'This can be undone from the notifier.',
            icon: 'warning',
            buttons: ['yes', 'no'],
          })
        : await dialogs.showTaskDialog({
            instruction: 'How do you want to continue?',
            icon: 'help',
            buttons: ['cancel'],
            commandLinks: [
              {
                id: 'a',
                title: 'Keep both',
                subLabel: 'Both transactions stay in the register.',
                isDefault: true,
              },
              { id: 'b', title: 'Merge them' },
            ],
          });
  lastResult.value = JSON.stringify(result);
}

const standardOpen = ref(false);

const calloutAnchor = shallowRef<HTMLElement | null>(null);
const tail = ref<Tail>('top');
function openCallout(e: MouseEvent, which: Tail): void {
  tail.value = which;
  calloutAnchor.value = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
}

async function showLoading(): Promise<void> {
  await loading.during('Loading budget…', new Promise((r) => setTimeout(r, 2000)));
}

const payee = ref('');
const payees: AutoCompleteEntry[] = [
  ...['Amazon', 'Costco', 'Kroger', 'Landlord', 'Starbucks', 'Target'].map((label) => ({
    kind: 'item' as const,
    id: label,
    label,
  })),
  { kind: 'heading', id: 'transfers', label: 'Transfer to/from account:' },
  ...['Checking', 'Savings', 'Visa'].map((a) => ({
    kind: 'item' as const,
    id: `t-${a}`,
    label: `Transfer : ${a}`,
  })),
];
const category = ref('');
const categories: AutoCompleteEntry[] = [
  { kind: 'heading', id: 'income', label: 'Income:' },
  { kind: 'item', id: 'tbb', label: 'Income: Available this month' },
  { kind: 'heading', id: 'monthly', label: 'Monthly Bills:' },
  { kind: 'item', id: 'rent', label: 'Rent/Mortgage' },
  { kind: 'item', id: 'phone', label: 'Phone' },
  { kind: 'heading', id: 'everyday', label: 'Everyday Expenses:' },
  { kind: 'item', id: 'groceries', label: 'Groceries' },
  { kind: 'item', id: 'fuel', label: 'Fuel' },
];

const amount = ref<Money | null>(12345);
const today = computed(() => todayOf(new Date()));
const date = ref<ISODate | null>(todayOf(new Date()));
const month = ref<Month>(todayOf(new Date()).slice(0, 7) as Month);
const calcResult = ref<Money | null>(null);
</script>

<template>
  <div class="gallery">
    <header class="gallery__bar">
      <h1 class="gallery__title">Component gallery</h1>
      <UiSegmented
        :model-value="palette"
        :options="palettes"
        label="Palette"
        @update:model-value="setPalette"
      />
      <UiLink @click="router.push('/')">Back to the app</UiLink>
    </header>

    <section class="gallery__section">
      <h2>Buttons</h2>
      <div class="row">
        <UiButton>Cancel</UiButton>
        <UiButton primary>Done</UiButton>
        <UiButton disabled>Disabled</UiButton>
        <UiSmallButton>Rename</UiSmallButton>
        <UiLink>Edit Payees</UiLink>
        <UiLink danger>Delete</UiLink>
        <UiMenuButton :expanded="menuOpen" @open="menuOpen = !menuOpen"
          >Edit Transactions</UiMenuButton
        >
        <UiChunkyButton :icon="Scale">{{ 'Reconcile\nAccount' }}</UiChunkyButton>
        <UiChunkyButton :icon="CalendarClock" :count="3">{{
          'Scheduled\nTransactions'
        }}</UiChunkyButton>
        <UiSegmented
          v-model="segmented"
          label="View"
          :options="[
            { value: 'budget', label: 'Budget' },
            { value: 'reports', label: 'Reports' },
          ]"
        />
      </div>
    </section>

    <section class="gallery__section">
      <h2>Dialogs and overlays</h2>
      <div class="row">
        <UiButton @click="taskDialog('info')">Task dialog (info)</UiButton>
        <UiButton @click="taskDialog('warning')">Task dialog (warning)</UiButton>
        <UiButton @click="taskDialog('links')">Task dialog (command links)</UiButton>
        <UiButton @click="standardOpen = true">Standard dialog</UiButton>
        <UiButton @click="showLoading">Loading overlay</UiButton>
        <span
          v-tooltip="'A tooltip: shown after 650 ms on hover or focus.'"
          tabindex="0"
          class="tip-target"
          >Tooltip target</span
        >
      </div>
      <p v-if="lastResult" class="result">Result: {{ lastResult }}</p>
      <div class="row">
        <UiSegmented
          :model-value="banner"
          :options="bannerStates"
          label="Connection banner"
          @update:model-value="setBanner"
        />
      </div>
    </section>

    <section class="gallery__section">
      <h2>Callout tail positions</h2>
      <div class="callout-grid">
        <UiButton v-for="p in TAILS" :key="p" @click="(e) => openCallout(e, p)">{{ p }}</UiButton>
      </div>
    </section>

    <section class="gallery__section">
      <h2>Inputs</h2>
      <div class="inputs">
        <div class="field">
          Payee <AutoComplete v-model="payee" :entries="payees" label="Payee" min-width="15.5rem" />
        </div>
        <div class="field">
          Category
          <AutoComplete
            v-model="category"
            :entries="categories"
            :filter="prefixFilter"
            label="Category"
            min-width="16rem"
          />
        </div>
        <div class="field">Outflow <MoneyInput v-model="amount" label="Outflow" /></div>
        <div class="field">
          Date <DateField v-model="date" label="Date" date-format="MM/dd/yyyy" :today="today" />
        </div>
        <span class="field"
          >Month <MonthPicker v-model="month" label="Month" from="2024-01" :to="month"
        /></span>
      </div>
      <p class="result">
        Amount (minor units): {{ amount }} · Date: {{ date }} · Month: {{ month }}
      </p>
    </section>

    <section class="gallery__section">
      <h2>Calculator</h2>
      <CalculatorPanel :initial="12345" @ok="(v) => (calcResult = v)" @cancel="calcResult = null" />
      <p class="result">Result: {{ calcResult }}</p>
    </section>

    <StandardDialog
      v-if="standardOpen"
      title="Standard dialog"
      width="sm"
      @cancel="standardOpen = false"
      @submit="standardOpen = false"
    >
      <label class="field">Name <input type="text" class="text-input" /></label>
      <template #footer>
        <UiButton @click="standardOpen = false">Cancel</UiButton>
        <UiButton primary @click="standardOpen = false">OK</UiButton>
      </template>
    </StandardDialog>

    <Callout
      v-if="calloutAnchor"
      :key="tail"
      :anchor="calloutAnchor"
      title="Callout"
      :placements="[tail]"
      buttons
      @close="calloutAnchor = null"
    >
      <p>Tail: {{ tail }}</p>
    </Callout>
  </div>
</template>

<style scoped>
.gallery {
  flex: 1;
  overflow: auto;
  background: var(--panel-bg);
  color: var(--text);
}

.gallery__bar {
  position: sticky;
  top: 0;
  display: flex;
  gap: var(--space-5);
  align-items: center;
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--register-border);
  background: var(--register-gray-bg);
  z-index: 1;
}

.gallery__title {
  margin: 0;
  font-size: var(--font-xl);
}

.gallery__section {
  padding: var(--space-5);
  border-bottom: 1px solid var(--register-border);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  margin-bottom: var(--space-3);
}

.callout-grid {
  display: grid;
  grid-template-columns: repeat(6, max-content);
  gap: var(--space-4) var(--space-6);
  padding: var(--space-7) 0;
  justify-content: center;
}

.inputs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.tip-target {
  text-decoration: underline dotted;
}

.result {
  color: var(--text-subtle);
  font-size: var(--font-sm);
}

.text-input {
  min-height: var(--hit-min);
  border: 1px solid var(--register-border);
  background: var(--panel-bg);
  color: var(--text);
}
</style>
