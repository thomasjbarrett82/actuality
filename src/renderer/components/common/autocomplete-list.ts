// AutoComplete list logic (11 §4), kept out of the component so it can be tested directly.
import type { Component } from 'vue';

export interface AutoCompleteItem {
  kind: 'item';
  id: string;
  /** The text the field takes when the item is chosen; filtering and type-ahead use it too. */
  label: string;
  /** What the list shows, when it differs from `label` (a category under its group heading). */
  text?: string;
  icon?: Component;
}

export interface AutoCompleteHeading {
  kind: 'heading';
  id: string;
  label: string;
}

export type AutoCompleteEntry = AutoCompleteItem | AutoCompleteHeading;

export type AutoCompleteFilter = (
  entries: readonly AutoCompleteEntry[],
  query: string,
) => AutoCompleteEntry[];

export interface AutoCompleteGroup {
  heading: AutoCompleteHeading | null;
  items: AutoCompleteItem[];
}

const fold = (s: string): string => s.toLocaleLowerCase();

/**
 * Filters with `match` on item labels. A heading stays when its own label matches or any of its items
 * does; its items stay when they match (11 §4.2). An empty query keeps everything.
 */
export function filterWith(match: (label: string, query: string) => boolean): AutoCompleteFilter {
  return (entries, query) => {
    if (query === '') return [...entries];
    const out: AutoCompleteEntry[] = [];
    let heading: AutoCompleteHeading | null = null;
    let headingAdded = false;
    for (const e of entries) {
      if (e.kind === 'heading') {
        heading = e;
        headingAdded = false;
        if (match(e.label, query)) {
          out.push(e);
          headingAdded = true;
        }
        continue;
      }
      if (!match(e.label, query)) continue;
      if (heading && !headingAdded) {
        out.push(heading);
        headingAdded = true;
      }
      out.push(e);
    }
    return out;
  };
}

/** Case-insensitive "contains" (the payee list, 11 §4.1). */
export const containsFilter = filterWith((label, query) => fold(label).includes(fold(query)));

/** Case-insensitive prefix match. */
export const prefixFilter = filterWith((label, query) => fold(label).startsWith(fold(query)));

export function groups(entries: readonly AutoCompleteEntry[]): AutoCompleteGroup[] {
  const out: AutoCompleteGroup[] = [];
  let current: AutoCompleteGroup = { heading: null, items: [] };
  for (const e of entries) {
    if (e.kind === 'heading') {
      if (current.heading || current.items.length) out.push(current);
      current = { heading: e, items: [] };
    } else {
      current.items.push(e);
    }
  }
  if (current.heading || current.items.length) out.push(current);
  return out;
}

export function itemsOf(entries: readonly AutoCompleteEntry[]): AutoCompleteItem[] {
  return entries.filter((e): e is AutoCompleteItem => e.kind === 'item');
}

/** The best match for type-ahead: the first item whose label starts with the typed text. */
export function bestMatch(
  items: readonly AutoCompleteItem[],
  query: string,
): AutoCompleteItem | null {
  if (query === '') return null;
  return items.find((i) => fold(i.label).startsWith(fold(query))) ?? null;
}

/** Splits a label around the first case-insensitive occurrence of `query`, for bolding the match. */
export function highlight(
  label: string,
  query: string,
): { before: string; match: string; after: string } {
  const at = query === '' ? -1 : fold(label).indexOf(fold(query));
  if (at === -1) return { before: label, match: '', after: '' };
  return {
    before: label.slice(0, at),
    match: label.slice(at, at + query.length),
    after: label.slice(at + query.length),
  };
}
