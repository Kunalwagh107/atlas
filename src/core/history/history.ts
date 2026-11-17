/**
 * Application-level snapshot history. Snapshots are immutable documents with structural
 * sharing at the node level, so storing 120 steps costs little even on large maps.
 */
export interface HistoryEntry<T> {
  snapshot: T;
  label: string;
  at: number;
  key?: string;
  /** Selection to restore when this entry is traversed (owned by the app layer). */
  selectionIds?: string[];
}

export interface HistoryState<T> {
  past: HistoryEntry<T>[];
  present: T;
  future: HistoryEntry<T>[];
  lastAction: string;
}

const MAX_ENTRIES = 120;
const COALESCE_WINDOW_MS = 700;

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], lastAction: '' };
}

function pushPast<T>(state: HistoryState<T>, entry: HistoryEntry<T>): HistoryEntry<T>[] {
  const past = [...state.past, entry];
  return past.length > MAX_ENTRIES ? past.slice(past.length - MAX_ENTRIES) : past;
}

export interface CommitOptions {
  label: string;
  /** Consecutive commits sharing a key inside the time window become one undo step. */
  coalesceKey?: string;
  /** Selection before this change; restored on undo. */
  selectionIds?: string[];
}

export interface RestoreOptions {
  /** Selection before undo/redo; restored on the reverse traversal. */
  selectionIds?: string[];
}

/** Apply a new present value and record the previous one as an undo step. */
export function commit<T>(state: HistoryState<T>, next: T, options: CommitOptions): HistoryState<T> {
  if (next === state.present) return state;
  const now = Date.now();
  const last = state.past[state.past.length - 1];
  const canCoalesce =
    !!options.coalesceKey &&
    !!last &&
    last.key === options.coalesceKey &&
    now - last.at < COALESCE_WINDOW_MS &&
    state.future.length === 0;
  return {
    // Refreshing `at` keeps a continuous typing run in one undo step; without it
    // the window was measured from the *first* keystroke and split after 700 ms.
    past: canCoalesce
      ? [...state.past.slice(0, -1), { ...last!, at: now }]
      : pushPast(state, {
      snapshot: state.present, label: options.label, at: now,
      key: options.coalesceKey, selectionIds: options.selectionIds,
    }),
    present: next,
    future: [],
    lastAction: options.label,
  };
}

/** Record an already-applied transient change (e.g. a completed drag) as one undo step. */
export function commitApplied<T>(state: HistoryState<T>, before: T, label: string): HistoryState<T> {
  if (before === state.present) return state;
  return {
    past: pushPast(state, { snapshot: before, label, at: Date.now() }),
    present: state.present,
    future: [],
    lastAction: label,
  };
}

export function undo<T>(state: HistoryState<T>, options: RestoreOptions = {}): HistoryState<T> {
  const entry = state.past[state.past.length - 1];
  if (!entry) return state;
  return {
    past: state.past.slice(0, -1),
    present: entry.snapshot,
    future: [...state.future, {
      snapshot: state.present, label: entry.label, at: Date.now(),
      selectionIds: options.selectionIds,
    }],
    lastAction: `Undo: ${entry.label}`,
  };
}

export function redo<T>(state: HistoryState<T>, options: RestoreOptions = {}): HistoryState<T> {
  const entry = state.future[state.future.length - 1];
  if (!entry) return state;
  return {
    past: pushPast(state, {
      snapshot: state.present, label: entry.label, at: Date.now(),
      selectionIds: options.selectionIds,
    }),
    present: entry.snapshot,
    future: state.future.slice(0, -1),
    lastAction: `Redo: ${entry.label}`,
  };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}
export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
