<script setup lang="ts">
// The privacy mode toggle (08 §2.4, 06 §7): an eye icon button left of the server web link. Always
// enabled, offline too, because it only changes how amounts are displayed.
import { Eye, EyeOff } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '../../stores/app';

const { t } = useI18n();
const app = useAppStore();
const tooltip = computed(() => t(app.privacyMode ? 'app.privacyDisable' : 'app.privacyEnable'));
</script>

<template>
  <button
    v-tooltip="tooltip"
    type="button"
    class="privacy"
    data-privacy-toggle
    :aria-label="t('a11y.privacyMode')"
    :aria-pressed="app.privacyMode"
    @click="app.togglePrivacyMode()"
  >
    <component :is="app.privacyMode ? EyeOff : Eye" class="privacy__icon" aria-hidden="true" />
  </button>
</template>

<style scoped>
.privacy {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-on-blue);
  cursor: pointer;
}

.privacy:hover {
  background: color-mix(in srgb, var(--text-on-blue) 15%, transparent);
}

.privacy__icon {
  width: var(--icon);
  height: var(--icon);
}
</style>
