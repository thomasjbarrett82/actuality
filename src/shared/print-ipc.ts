// The print preview window's toolbar channels (16 §3), sent by its own preload. A module of its own: the
// two sandboxed preloads must not share a chunk, which a sandboxed preload can't load.
export const PRINT_IPC = {
  print: 'print-preview:print',
  savePdf: 'print-preview:savePdf',
} as const;
