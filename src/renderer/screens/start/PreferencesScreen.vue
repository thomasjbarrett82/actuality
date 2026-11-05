<script setup lang="ts">
// Preferences (07 §7): Startup, Server (sign-in, certificate), Offline Cache, Appearance, Tags, Language,
// Auto-fill, File Associations and Diagnostics. Changes apply at once; Done returns to where it was opened
// from.
import { availableLocales, LOCALE_META } from '@shared/i18n/locales';
import type { AppSettings, RendererWritableAppKey } from '@shared/settings';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { trustCertificate } from '../../certificates';
import UiButton from '../../components/common/UiButton.vue';
import UiLink from '../../components/common/UiLink.vue';
import { openTagsManager } from '../../register/tag-dialogs';
import { host } from '../../rpc/host-client';
import { changeServer, leaveStartScreen, showUnexpected, signOut } from '../../session';
import { confirmLeave } from '../../session-flows';
import { useAppStore } from '../../stores/app';
import { useConnection } from '../../stores/connection';
import { useDialogs } from '../../stores/dialogs';
import { useSettings } from '../../stores/settings';
import { useStart } from '../../stores/start';

const { t } = useI18n();
const settings = useSettings();
const connection = useConnection();
const isMac = window.app.shell.platform === 'darwin';

const serverUrl = computed(() => connection.info.serverUrl);
const signedIn = computed(() => !['Disconnected', 'AuthRequired'].includes(connection.info.state));
const secureStorage = ref(true);
const staySignedIn = ref(false);
const cacheFolder = ref('');

onMounted(async () => {
  secureStorage.value = await window.app.shell.secrets.available();
  cacheFolder.value = await window.app.shell.cacheFolder();
  if (serverUrl.value)
    staySignedIn.value = await window.app.shell.secrets.has(`server:${serverUrl.value}`);
});

function set<K extends RendererWritableAppKey>(key: K, value: AppSettings[K]): void {
  void settings.set(key, value);
}
const checked = (e: Event): boolean => (e.target as HTMLInputElement).checked;
const value = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value;

async function toggleStaySignedIn(on: boolean): Promise<void> {
  try {
    await host.call('session.setStaySignedIn', { on });
    staySignedIn.value = on;
  } catch (e) {
    staySignedIn.value = !on;
    await showUnexpected(e);
  }
}

async function showCacheFolder(): Promise<void> {
  await window.app.shell.showCacheFolder();
}

async function removeCertificate(): Promise<void> {
  await window.app.shell.removeCertificateFile();
}

async function clearCache(): Promise<void> {
  const { button } = await useDialogs().showTaskDialog({
    instruction: t('app.clearCacheTitle'),
    content: t('app.clearCacheMessage'),
    icon: 'warning',
    buttons: [{ id: 'clear', label: t('app.clearCacheConfirm') }, 'cancel'],
  });
  if (button !== 'clear' || !(await confirmLeave('close'))) return;
  try {
    await host.call('session.clearCache', { force: true });
  } catch (e) {
    await showUnexpected(e);
    return;
  }
  // The budget is closed: Done now leads to the Budget List (03 §2).
  const start = useStart();
  start.returnTo = 'budgets';
  start.canGoBack = false;
  useAppStore().navigate('start');
}

const languages = computed(() =>
  availableLocales()
    .map((code) => ({ code, name: LOCALE_META[code]?.name ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);
</script>

<template>
  <section class="prefs" aria-labelledby="prefs-title">
    <h1 id="prefs-title" class="prefs__title">{{ t('app.prefsTitle') }}</h1>

    <div class="prefs__panel">
      <section class="prefs__section" aria-labelledby="prefs-startup">
        <h2 id="prefs-startup" class="prefs__heading">{{ t('app.prefsStartup') }}</h2>
        <label class="check">
          <input
            type="checkbox"
            :checked="settings.app.openLastBudgetOnStartup"
            @change="set('openLastBudgetOnStartup', checked($event))"
          />
          {{ t('app.prefsOpenLast') }}
        </label>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-server">
        <h2 id="prefs-server" class="prefs__heading">{{ t('app.prefsServer') }}</h2>
        <p class="prefs__row">
          <span>{{
            serverUrl ? t('app.connectedTo', { url: serverUrl }) : t('app.notConnected')
          }}</span>
          <template v-if="serverUrl">
            <UiLink @click="signOut">{{ t('app.signOut') }}</UiLink>
            <UiLink @click="changeServer">{{ t('app.changeServer') }}</UiLink>
          </template>
        </p>
        <label class="check" :title="secureStorage ? undefined : t('app.secureStorageUnavailable')">
          <input
            type="checkbox"
            :checked="staySignedIn"
            :disabled="!secureStorage || !serverUrl || (!signedIn && !staySignedIn)"
            @change="toggleStaySignedIn(checked($event))"
          />
          {{ t('app.staySignedIn') }}
        </label>
        <div class="prefs__row">
          <UiButton @click="trustCertificate">{{ t('app.trustCertificateFile') }}</UiButton>
          <template v-if="settings.app.extraCaCertPath">
            <span class="prefs__path">{{ settings.app.extraCaCertPath }}</span>
            <UiButton @click="removeCertificate">{{ t('app.certificateRemove') }}</UiButton>
          </template>
        </div>
        <p class="prefs__hint">{{ t('app.certificateHint') }}</p>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-cache">
        <h2 id="prefs-cache" class="prefs__heading">{{ t('app.prefsOfflineCache') }}</h2>
        <p class="prefs__text">{{ t('app.prefsCacheText') }}</p>
        <div class="prefs__row">
          <input
            class="input prefs__grow"
            type="text"
            readonly
            :value="cacheFolder"
            :aria-label="t('app.prefsCacheFolder')"
          />
          <UiButton @click="showCacheFolder">{{ t('app.showInFolder') }}</UiButton>
          <UiButton @click="clearCache">{{ t('app.prefsClearCache') }}</UiButton>
        </div>
        <label class="check">
          <input
            type="checkbox"
            :checked="settings.app.clearCacheOnExit"
            @change="set('clearCacheOnExit', checked($event))"
          />
          {{ t('app.prefsClearOnQuit') }}
        </label>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-appearance">
        <h2 id="prefs-appearance" class="prefs__heading">{{ t('app.prefsAppearance') }}</h2>
        <fieldset class="prefs__radios">
          <legend>{{ t('app.prefsTheme') }}</legend>
          <label v-for="option in ['system', 'light', 'dark'] as const" :key="option" class="check">
            <input
              type="radio"
              name="appearance"
              :value="option"
              :checked="settings.app.appearance === option"
              @change="set('appearance', option)"
            />
            {{
              option === 'system'
                ? t('app.useSystemSetting')
                : option === 'light'
                  ? t('app.prefsThemeLight')
                  : t('app.prefsThemeDark')
            }}
          </label>
        </fieldset>
        <label class="check">
          <input
            type="checkbox"
            :checked="settings.app.colorVision === 'cvd'"
            aria-describedby="prefs-cvd-hint"
            @change="set('colorVision', checked($event) ? 'cvd' : 'standard')"
          />
          {{ t('app.prefsColorVision') }}
        </label>
        <p id="prefs-cvd-hint" class="prefs__hint">{{ t('app.prefsColorVisionHint') }}</p>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-tags">
        <h2 id="prefs-tags" class="prefs__heading">{{ t('app.prefsTags') }}</h2>
        <div class="prefs__row">
          <UiButton :disabled="connection.info.budget === null" @click="openTagsManager">{{
            t('app.prefsManageTags')
          }}</UiButton>
        </div>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-language">
        <h2 id="prefs-language" class="prefs__heading">{{ t('app.prefsLanguage') }}</h2>
        <div class="prefs__row">
          <label for="prefs-language-select">{{ t('app.prefsLanguageLabel') }}</label>
          <select
            id="prefs-language-select"
            class="input"
            :value="settings.app.language"
            @change="set('language', value($event))"
          >
            <option value="system">{{ t('app.useSystemSetting') }}</option>
            <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.name }}</option>
          </select>
        </div>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-autofill">
        <h2 id="prefs-autofill" class="prefs__heading">{{ t('app.prefsAutofill') }}</h2>
        <div class="prefs__row">
          <label class="check">
            <input
              type="checkbox"
              :checked="settings.app.autofillCategory"
              @change="set('autofillCategory', checked($event))"
            />
            {{ t('app.prefsAutofillCategory') }}
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="settings.app.autofillNotes"
              @change="set('autofillNotes', checked($event))"
            />
            {{ t('app.prefsAutofillNotes') }}
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="settings.app.autofillAmount"
              @change="set('autofillAmount', checked($event))"
            />
            {{ t('app.prefsAutofillAmount') }}
          </label>
        </div>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-files">
        <h2 id="prefs-files" class="prefs__heading">{{ t('app.prefsFileAssociations') }}</h2>
        <p v-if="isMac" class="prefs__text">{{ t('app.prefsFileAssociationsMac') }}</p>
        <label v-else class="check">
          <input
            type="checkbox"
            :checked="settings.app.fileAssociations"
            @change="set('fileAssociations', checked($event))"
          />
          {{ t('app.prefsFileAssociationsToggle') }}
        </label>
      </section>

      <section class="prefs__section" aria-labelledby="prefs-diagnostics">
        <h2 id="prefs-diagnostics" class="prefs__heading">{{ t('app.prefsDiagnostics') }}</h2>
        <label class="check">
          <input
            type="checkbox"
            :checked="settings.app.debugLogging"
            aria-describedby="prefs-debug-hint"
            @change="set('debugLogging', checked($event))"
          />
          {{ t('app.prefsDebugLogging') }}
        </label>
        <p id="prefs-debug-hint" class="prefs__hint">{{ t('app.prefsDebugLoggingHint') }}</p>
      </section>
    </div>

    <div class="prefs__buttons">
      <UiButton primary @click="leaveStartScreen">{{ t('app.prefsDone') }}</UiButton>
    </div>
  </section>
</template>

<style scoped>
.prefs__title {
  margin: 0 0 var(--space-6);
  font-size: var(--font-xl);
  font-weight: 400;
  text-align: center;
}

.prefs__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
}

.prefs__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.prefs__section + .prefs__section {
  padding-top: var(--space-5);
  border-top: 1px solid var(--register-border);
}

.prefs__heading {
  margin: 0;
  font-size: var(--font-md);
  font-weight: 600;
}

.prefs__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
  align-items: center;
  margin: 0;
}

.prefs__grow {
  flex: 1;
  min-width: 12rem;
}

.prefs__text,
.prefs__hint {
  margin: 0;
}

.prefs__hint {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.prefs__path {
  overflow-wrap: anywhere;
  font-size: var(--font-sm);
}

.prefs__radios {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-5);
  margin: 0;
  padding: 0;
  border: 0;
}

.prefs__radios legend {
  float: left;
  margin-right: var(--space-4);
}

.input {
  min-height: var(--hit-min);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--register-border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text);
  font-size: var(--font-body);
}

.check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.prefs__buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-5);
}
</style>
