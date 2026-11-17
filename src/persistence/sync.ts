import { uid } from '../utils/common';

/**
 * Cross-tab save coordination.
 *
 * IndexedDB itself is last-write-wins, so two tabs editing the same map would
 * silently overwrite each other. Every save publishes a monotonically increasing
 * revision through `localStorage` (readable synchronously before a write) and a
 * `BroadcastChannel` (instant notification). A tab refuses to write when it sees
 * a newer revision it has not accepted, and asks the user how to resolve it.
 *
 * Everything here is best-effort: if storage or BroadcastChannel is unavailable
 * the app keeps working with the previous single-tab behaviour.
 */

export interface SaveSignal {
  type: 'atlas:save';
  mapId: string;
  tabId: string;
  revision: number;
  title: string;
  at: number;
}

const CHANNEL_NAME = 'atlas:map-sync';
/** Exported so the IndexedDB fallback path uses exactly the same revision slot. */
export const REVISION_PREFIX = 'atlas:rev:';
export const LAST_SAVE_KEY = 'atlas:last-save';

export const TAB_ID = uid('tab');

type Listener = (signal: SaveSignal) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let listening = false;

function safeStorage(): Storage | null {
  try {
    // `globalThis` also covers the Node test environment, which provides an
    // in-memory Storage without a `window`.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function notify(signal: SaveSignal): void {
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch {
      /* a listener must never break saving in another tab */
    }
  }
}

function handleMessage(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const signal = value as Partial<SaveSignal>;
  if (signal.type !== 'atlas:save') return;
  if (typeof signal.mapId !== 'string' || typeof signal.revision !== 'number') return;
  if (signal.tabId === TAB_ID) return;
  notify({
    type: 'atlas:save',
    mapId: signal.mapId,
    tabId: String(signal.tabId ?? 'unknown'),
    revision: signal.revision,
    title: String(signal.title ?? ''),
    at: Number(signal.at ?? Date.now()),
  });
}

function ensureListening(): void {
  if (listening) return;
  listening = true;
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => handleMessage(event.data);
    } catch {
      channel = null;
    }
  }
  if (typeof window !== 'undefined') {
    // Fallback for browsers without BroadcastChannel (and for suspended tabs
    // that were not listening when the message was posted).
    window.addEventListener('storage', (event) => {
      if (event.key !== LAST_SAVE_KEY || !event.newValue) return;
      try {
        handleMessage(JSON.parse(event.newValue) as unknown);
      } catch {
        /* ignore malformed payloads */
      }
    });
  }
}

/** Subscribe to saves made by other tabs. Returns an unsubscribe function. */
export function subscribeToSaves(listener: Listener): () => void {
  ensureListening();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Latest revision known to this browser, or 0 when the map has never been saved. */
export function readRevision(mapId: string): number {
  const storage = safeStorage();
  if (!storage) return 0;
  const value = Number(storage.getItem(`${REVISION_PREFIX}${mapId}`));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Reserve the next revision for a write. Timestamp-based so it stays meaningful
 * across reloads, but always greater than the stored value to stay monotonic.
 */
export function claimRevision(mapId: string): number {
  const revision = Math.max(Date.now(), readRevision(mapId) + 1);
  const storage = safeStorage();
  if (storage) {
    try {
      storage.setItem(`${REVISION_PREFIX}${mapId}`, String(revision));
    } catch {
      /* quota or private mode — in-memory state still works */
    }
  }
  return revision;
}

/** Announce a completed write to every other tab. */
export function publishSave(mapId: string, revision: number, title: string): void {
  ensureListening();
  const signal: SaveSignal = {
    type: 'atlas:save',
    mapId,
    tabId: TAB_ID,
    revision,
    title,
    at: Date.now(),
  };
  const storage = safeStorage();
  if (storage) {
    try {
      storage.setItem(LAST_SAVE_KEY, JSON.stringify(signal));
    } catch {
      /* ignore */
    }
  }
  try {
    channel?.postMessage(signal);
  } catch {
    /* channel closed during unload */
  }
}

/** Test hook: forget listeners/channel (never called by the app). */
export function resetSyncForTests(): void {
  listeners.clear();
  channel?.close();
  channel = null;
  listening = false;
}
