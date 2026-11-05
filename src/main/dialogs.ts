// File dialogs and folders for the renderer (02 §4, 16 §1–2): open a bank file, save a file, pick an
// export folder, open a folder in the OS file manager, and save the sample CSV (16 §1.3). Paths go back
// to the renderer, which hands them to the API host to read or write.
import type { FileFilter } from '@shared/shell-api';
import { dialog, shell, type BrowserWindow } from 'electron';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The bundled sample of the CSV format the import reads (16 §1.3), saved when a CSV can't be read. */
export const SAMPLE_IMPORT_CSV = [
  'Date,Payee,Category,Notes,Outflow,Inflow',
  '01/05/2026,Grocery Store,Everyday Expenses: Groceries,Weekly shopping,45.20,',
  '01/06/2026,Employer,Income: Available This Month,Paycheck,,2000.00',
  '01/08/2026,Water Company,Monthly Bills: Water,,30.00,',
  '',
].join('\r\n');

export async function openFile(
  win: BrowserWindow,
  opts: { title: string; filters: FileFilter[] },
): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    title: opts.title,
    properties: ['openFile'],
    filters: opts.filters,
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export async function saveFile(
  win: BrowserWindow,
  opts: { title: string; defaultPath: string; filters: FileFilter[] },
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    title: opts.title,
    defaultPath: opts.defaultPath,
    filters: opts.filters,
  });
  return result.canceled ? null : result.filePath || null;
}

export async function chooseFolder(
  win: BrowserWindow,
  opts: { title: string; defaultPath: string },
): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    title: opts.title,
    defaultPath: opts.defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Opens a folder (never a file) in the OS file manager. */
export async function openFolder(path: string): Promise<void> {
  let dir: boolean;
  try {
    dir = statSync(path).isDirectory();
  } catch {
    dir = false;
  }
  if (!dir) throw new Error('Only folders can be opened.');
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}

/** Shows a file (never runs it) in the OS file manager, selected (07 §6 Show in Folder). */
export function showInFolder(path: string): void {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) throw new Error('No such file.');
  shell.showItemInFolder(path);
}

/** Saves the sample CSV where the user chooses, by default the Desktop (16 §1.3). Returns the path. */
export async function saveSampleImport(
  win: BrowserWindow,
  title: string,
  desktop: string,
): Promise<string | null> {
  const path = await saveFile(win, {
    title,
    defaultPath: join(desktop, 'SampleImport.csv'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (!path) return null;
  writeFileSync(path, SAMPLE_IMPORT_CSV, 'utf8');
  return path;
}
