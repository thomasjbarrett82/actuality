// The Keyboard Shortcuts dialog's content (06 §6.1): the shortcuts worth discovering, by area, from the
// menu table (06 §4) and the key tables (09 §7, 10 §9, 11 §9, 22 §2). Labels are message keys.

/** A key in a combination: a named key (translated when shown) or the key's own text. */
export type KeyToken =
  | 'mod'
  | 'ctrl'
  | 'shift'
  | 'alt'
  | 'enter'
  | 'tab'
  | 'esc'
  | 'delete'
  | 'numPlus'
  | (string & Record<never, never>);

export interface Shortcut {
  /** Alternative combinations, each a list of keys pressed together. */
  keys: readonly (readonly KeyToken[])[];
  /** The combinations on macOS, when they differ by more than ⌘ for Ctrl. */
  macKeys?: readonly (readonly KeyToken[])[];
  label: string;
}

export interface ShortcutSection {
  title: string;
  items: readonly Shortcut[];
}

export const SHORTCUT_SECTIONS: readonly ShortcutSection[] = [
  {
    title: 'shortcuts.sectionGeneral',
    items: [
      { keys: [['?']], label: 'shortcuts.showShortcuts' },
      { keys: [['mod', 'O']], label: 'shortcuts.openBudget' },
      { keys: [['mod', 'S']], label: 'shortcuts.syncNow' },
      { keys: [['mod', 'I']], label: 'shortcuts.importTransactions' },
      { keys: [['mod', 'E']], label: 'shortcuts.export' },
      { keys: [['mod', 'P']], label: 'shortcuts.print' },
      { keys: [['mod', ',']], label: 'shortcuts.preferences' },
      { keys: [['mod', 'Z']], label: 'shortcuts.undoText' },
      { keys: [['mod', 'shift', 'Z']], label: 'shortcuts.redoText' },
      { keys: [['mod', 'T']], label: 'shortcuts.goAccounts' },
      { keys: [['mod', 'B']], label: 'shortcuts.goBudget' },
      { keys: [['mod', 'R']], label: 'shortcuts.goReports' },
      { keys: [['mod', 'Y']], label: 'shortcuts.goPayees' },
      { keys: [['mod', 'U']], label: 'shortcuts.goRules' },
      { keys: [['mod', 'shift', 'P']], label: 'shortcuts.privacyMode' },
      {
        keys: [
          ['mod', '='],
          ['mod', 'shift', '='],
          ['mod', 'numPlus'],
        ],
        label: 'shortcuts.zoomIn',
      },
      { keys: [['mod', '-']], label: 'shortcuts.zoomOut' },
      { keys: [['mod', '0']], label: 'shortcuts.actualSize' },
      { keys: [['F11']], macKeys: [['ctrl', 'mod', 'F']], label: 'shortcuts.fullScreen' },
      { keys: [['F6'], ['shift', 'F6']], label: 'shortcuts.regions' },
      { keys: [['shift', 'F10']], label: 'shortcuts.contextMenu' },
    ],
  },
  {
    title: 'shortcuts.sectionBudget',
    items: [
      { keys: [['←'], ['→']], label: 'shortcuts.budgetMonths' },
      { keys: [['0']], label: 'shortcuts.budgetCurrentMonth' },
      { keys: [['enter'], ['tab'], ['↓']], label: 'shortcuts.budgetNext' },
      { keys: [['shift', 'enter'], ['shift', 'tab'], ['↑']], label: 'shortcuts.budgetPrevious' },
      { keys: [['F2']], label: 'shortcuts.budgetQuickBudget' },
      {
        keys: [
          ['mod', '←'],
          ['mod', '→'],
        ],
        label: 'shortcuts.budgetGroups',
      },
    ],
  },
  {
    title: 'shortcuts.sectionRegister',
    items: [
      { keys: [['T'], ['mod', 'N']], label: 'shortcuts.registerAdd' },
      { keys: [['enter'], ['F2']], label: 'shortcuts.registerEdit' },
      { keys: [['↓'], ['J']], label: 'shortcuts.registerNext' },
      { keys: [['↑'], ['K']], label: 'shortcuts.registerPrevious' },
      {
        keys: [
          ['shift', '↓'],
          ['shift', '↑'],
        ],
        label: 'shortcuts.registerExtend',
      },
      { keys: [['mod', 'A']], label: 'shortcuts.registerSelectAll' },
      { keys: [['mod', 'F']], label: 'shortcuts.registerSearch' },
      { keys: [['E']], label: 'shortcuts.registerDate' },
      { keys: [['P']], label: 'shortcuts.registerPayee' },
      { keys: [['N']], label: 'shortcuts.registerNotes' },
      { keys: [['M']], label: 'shortcuts.registerAmount' },
      { keys: [['C']], label: 'shortcuts.registerCategorize' },
      { keys: [['A']], label: 'shortcuts.registerMove' },
      { keys: [['L'], ['mod', 'shift', 'C']], label: 'shortcuts.registerCleared' },
      { keys: [['V']], label: 'shortcuts.registerApprove' },
      { keys: [['S']], label: 'shortcuts.registerRecurring' },
      { keys: [['G']], label: 'shortcuts.registerMatch' },
      { keys: [['D'], ['delete']], label: 'shortcuts.registerDelete' },
      { keys: [['mod', 'Z']], label: 'shortcuts.registerUndo' },
      { keys: [['F5']], label: 'shortcuts.registerResort' },
    ],
  },
  {
    title: 'shortcuts.sectionEditor',
    items: [
      { keys: [['tab'], ['shift', 'tab']], label: 'shortcuts.editorFields' },
      { keys: [['enter']], label: 'shortcuts.editorEnter' },
      { keys: [['shift', 'enter']], label: 'shortcuts.editorMoveUp' },
      { keys: [['mod', 'enter']], label: 'shortcuts.editorSave' },
      { keys: [['mod', 'shift', 'enter']], label: 'shortcuts.editorRecurring' },
      { keys: [['esc']], label: 'shortcuts.editorEsc' },
      { keys: [['+'], ['-'], ['*'], ['/']], label: 'shortcuts.editorCalculator' },
      { keys: [['alt', 'N']], label: 'shortcuts.editorCheckNumber' },
    ],
  },
];
