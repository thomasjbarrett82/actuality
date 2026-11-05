// The print preview (16 §3): the renderer's print view (a whole HTML document, styled for paper) is written
// to a temporary file and loaded in a hidden window, which is shown as "Print Preview" once loaded. Its
// toolbar (hidden when printing) has Print… (the OS dialog) and Save as PDF… (printToPDF). One preview
// at a time.
import { APP_ID } from '@shared/app';
import { PRINT_IPC } from '@shared/print-ipc';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PreviewTexts {
  title: string;
  print: string;
  savePdf: string;
  pdfFilter: string;
}

let current: { win: BrowserWindow; pdfName: string; pdfFilter: string } | null = null;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The toolbar the preview adds above the document; `@media print` hides it. */
export function withToolbar(html: string, texts: PreviewTexts): string {
  const bar =
    '<div class="pp-toolbar">' +
    `<button type="button" id="pp-print">${escapeHtml(texts.print)}</button>` +
    `<button type="button" id="pp-pdf">${escapeHtml(texts.savePdf)}</button></div>`;
  const css =
    '<style>.pp-toolbar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;' +
    'padding:8px 12px;background:#eceeee;border-bottom:1px solid #c6c9c9;font:13px system-ui,' +
    'sans-serif}.pp-toolbar button{padding:4px 14px;font:inherit;cursor:pointer}' +
    '@media print{.pp-toolbar{display:none}}</style>';
  return html.replace(/<\/head>/i, `${css}</head>`).replace(/<body([^>]*)>/i, `<body$1>${bar}`);
}

export async function showPreview(
  parent: BrowserWindow,
  html: string,
  pdfName: string,
  texts: PreviewTexts,
  preload: string,
): Promise<void> {
  current?.win.close();
  const dir = mkdtempSync(join(tmpdir(), `${APP_ID}-print-`));
  const file = join(dir, 'print.html');
  writeFileSync(file, withToolbar(html, texts), 'utf8');
  const win = new BrowserWindow({
    parent,
    show: false,
    width: 900,
    height: 1000,
    title: texts.title,
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  current = { win, pdfName, pdfFilter: texts.pdfFilter };
  win.on('page-title-updated', (e) => {
    e.preventDefault();
  });
  win.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    if (current?.win === win) current = null;
    rmSync(dir, { recursive: true, force: true });
  });
  await win.loadFile(file);
  win.show();
}

/** The preview toolbar's buttons, sent by its preload. */
export function registerPrintHandlers(): void {
  ipcMain.on(PRINT_IPC.print, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.webContents.print({});
  });
  ipcMain.on(PRINT_IPC.savePdf, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const preview = current;
    if (!win || preview?.win !== win) return;
    void (async () => {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: preview.pdfName,
        filters: [{ name: preview.pdfFilter, extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return;
      writeFileSync(result.filePath, await win.webContents.printToPDF({ printBackground: true }));
    })();
  });
}
