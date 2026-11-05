// The About dialog's versions (18 §1) and the bundled third-party license file. The git commit and the
// Actual API version are fixed at build time (electron.vite.config.ts).
import type { AppInfo } from '@shared/shell-api';
import { app } from 'electron';
import { join } from 'node:path';

/** out/THIRD-PARTY-LICENSES.txt, unpacked from the asar archive so the OS can open it (electron-builder.yml). */
export function licensesPath(): string {
  return join(app.getAppPath(), 'out', 'THIRD-PARTY-LICENSES.txt').replace(
    /app\.asar([/\\])/,
    'app.asar.unpacked$1',
  );
}

export function appInfo(version: string, licenses: boolean): AppInfo {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    version,
    gitSha: env['APP_GIT_SHA'] ?? '',
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    actualApi: env['APP_ACTUAL_API_VERSION'] ?? '',
    licenses,
  };
}
