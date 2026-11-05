// The print preview window's preload (16 §3): wires the toolbar's Print… and Save as PDF… buttons to
// main. The page itself runs no script.
import { PRINT_IPC } from '@shared/print-ipc';
import { ipcRenderer } from 'electron';

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pp-print')?.addEventListener('click', () => {
    ipcRenderer.send(PRINT_IPC.print);
  });
  document.getElementById('pp-pdf')?.addEventListener('click', () => {
    ipcRenderer.send(PRINT_IPC.savePdf);
  });
});
