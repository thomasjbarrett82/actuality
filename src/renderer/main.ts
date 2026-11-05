// Renderer entry (02 §1): fonts and tokens, Pinia, the router, Vue Query with `data:changed` invalidation
// (03 §4.1), i18n with the `language` setting (20 §3.3), the keyboard dispatcher, the host port, and the
// startup sequence (07 §1) once the settings have loaded. It is the renderer's composition root: the
// logging aspects are woven here, and it holds the error boundary (02 §8.5).
import '@fontsource/source-sans-3/400-italic.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import { isDebug, setDebug } from '@shared/aspects/level';
import { describeError } from '@shared/aspects/log-entry';
import { advise } from '@shared/aspects/weave';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import App from './App.vue';
import { rpcClientAspect } from './aspects/logging';
import { vScrollFocus } from './components/common/scroll-focus';
import { vTooltip } from './components/common/tooltip';
import { applyLanguage, i18n } from './i18n';
import { keyboard } from './keyboard/dispatcher';
import { write } from './log';
import { router } from './router';
import { host } from './rpc/host-client';
import { queryClient } from './rpc/query-client';
import { invalidateTables } from './rpc/query-keys';
import { startup } from './session';
import { useConnection } from './stores/connection';
import { useSettings } from './stores/settings';
import './styles/base.css';
import './styles/tokens.css';

// The error boundary (02 §8.2).
window.addEventListener('error', (e) => {
  write('error', 'renderer.error', describeError(e.error ?? e.message, isDebug()));
});
window.addEventListener('unhandledrejection', (e) => {
  write('error', 'renderer.unhandledRejection', describeError(e.reason, isDebug()));
});

host.request = advise(
  host.request.bind(host),
  { name: ([, method]) => method, process: 'renderer', callId: ([id]) => id, args: ([, , p]) => p },
  [rpcClientAspect],
);
host.listen(window);
host.on('data:changed', ({ tables }) => void invalidateTables(queryClient, tables));
keyboard.install(window);

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(router);
app.use(VueQueryPlugin, { queryClient });
app.directive('tooltip', vTooltip);
app.directive('scroll-focus', vScrollFocus);
app.config.errorHandler = (e) => {
  write('error', 'renderer.vueError', describeError(e, isDebug()));
};

const settings = useSettings();
useConnection().start();
void settings.load().then(async () => {
  // The renderer's log level follows the setting (02 §8.3).
  watch(
    () => settings.app.debugLogging,
    (on) => {
      setDebug(on);
    },
    { immediate: true },
  );
  const systemLanguages = await window.app.shell.systemLanguages();
  watch(
    () => settings.app.language,
    (language) => void applyLanguage(language, systemLanguages),
    { immediate: true },
  );
  await startup();
});

app.mount('#app');
