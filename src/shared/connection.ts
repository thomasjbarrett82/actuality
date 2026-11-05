// Connection states and the renderer's view of them (03 §4).
import type { BudgetType, Id } from './domain/types';

export const CONNECTION_STATES = [
  'Disconnected',
  'SignedIn',
  'Connecting',
  'Online',
  'Syncing',
  'OfflineReadOnly',
  'Reconnecting',
  'AuthRequired',
  'Error',
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** The `connection:state` event payload (03 §4). */
export interface ConnectionInfo {
  state: ConnectionState;
  /** Epoch ms of the last successful sync, or null. */
  lastSyncAt: number | null;
  unsyncedChanges: boolean;
  /** True in OfflineReadOnly after a cancelled sign-in (no valid token). */
  signedOut: boolean;
  /** Error state details: an Actual error code, or a short reason. */
  message?: string;
  /** Server URL, when one is configured. */
  serverUrl: string | null;
  /** The open budget, or null. */
  budget: OpenBudgetInfo | null;
}

/** The `budget:opened` event payload (03 §6.1). */
export interface OpenBudgetInfo {
  cloudFileId: Id;
  groupId: string;
  name: string;
  budgetType: BudgetType;
  /** True for the offline fallback (local-only session, 03 §6.2). */
  localOnly: boolean;
}

/** Connection diagnosis of a failed reachability probe (03 §9.1). */
export type Diagnosis =
  'none' | 'tls-name-mismatch' | 'tls-untrusted' | 'tls-expired' | 'tls-other' | 'needs-https';

/** Writes are allowed only in Online and Syncing (03 §5.3). */
export function canEdit(state: ConnectionState): boolean {
  return state === 'Online' || state === 'Syncing';
}

export const INITIAL_CONNECTION: ConnectionInfo = {
  state: 'Disconnected',
  lastSyncAt: null,
  unsyncedChanges: false,
  signedOut: false,
  serverUrl: null,
  budget: null,
};
