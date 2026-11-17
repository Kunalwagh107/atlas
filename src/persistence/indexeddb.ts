import { uid } from '../utils/common';
import { parseDocument } from '../core/mindmap/validation';
import type { MapSummary, MindMapDocument } from '../core/mindmap/types';
import {
  DEFAULT_LOCAL_SETTINGS,
  type LocalSettings,
  type MapRepository,
} from './repository';
import { readRevision, REVISION_PREFIX } from './sync';

const DB_NAME = 'atlas-mindmaps';
/** v3 adds atomic revisions and per-map image blobs. */
const DB_VERSION = 3;
const STORE = 'maps';
export const VERSION_STORE = 'versions';
export const REVISION_STORE = 'revisions';
export const IMAGE_BLOB_STORE = 'imageBlobs';

/** Raised by `saveAtomic` when a concurrent tab already claimed a newer revision. */
export class RevisionConflictError extends Error {
  readonly mapId: string;
  readonly expected: number;
  readonly actual: number;
  constructor(mapId: string, expected: number, actual: number) {
    super('This map was saved in another tab');
    this.name = 'RevisionConflictError';
    this.mapId = mapId;
    this.expected = expected;
    this.actual = actual;
  }
}
const SETTINGS_KEY = 'atlas:local-settings';
const FALLBACK_PREFIX = 'atlas:map:';

interface StoredRecord {
  id: string;
  title: string;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
  doc: MindMapDocument;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let currentDb: IDBDatabase | null = null;

/** Test hook: close and forget the memoised connection/backoff. */
export function resetAtlasDatabaseForTests(): void {
  try { currentDb?.close(); } catch { /* already closed */ }
  currentDb = null;
  dbPromise = null;
  retryAfter = 0;
}
/**
 * A `blocked` open means another tab is mid-upgrade; retrying immediately just
 * blocks again. Back off briefly instead of giving up for the whole session —
 * a permanently cached `null` used to hide every stored map behind the
 * localStorage fallback until reload.
 */
let retryAfter = 0;
const BLOCKED_BACKOFF_MS = 1_500;

/** Shared connection for every repository in this database (maps + versions). */
export function openAtlasDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (Date.now() < retryAfter) return Promise.resolve(null);
  dbPromise = new Promise((resolve) => {
    let settled = false;
    /** Release the memo so the next caller retries instead of inheriting `null`. */
    const fail = (): void => {
      if (settled) return;
      settled = true;
      dbPromise = null;
      resolve(null);
    };
    try {
      if (typeof indexedDB === 'undefined') {
        settled = true;
        dbPromise = null;
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(VERSION_STORE)) {
          const versions = db.createObjectStore(VERSION_STORE, { keyPath: 'id' });
          versions.createIndex('mapId', 'mapId');
          versions.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(REVISION_STORE)) {
          db.createObjectStore(REVISION_STORE, { keyPath: 'mapId' });
        }
        if (!db.objectStoreNames.contains(IMAGE_BLOB_STORE)) {
          const blobs = db.createObjectStore(IMAGE_BLOB_STORE, { keyPath: 'key' });
          blobs.createIndex('mapId', 'mapId');
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        retryAfter = 0;
        const db = request.result;
        currentDb = db;
        // Another tab may request an upgrade; release our handle so it can proceed.
        db.onversionchange = () => {
          db.close();
          if (currentDb === db) currentDb = null;
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = fail;
      request.onblocked = () => {
        retryAfter = Date.now() + BLOCKED_BACKOFF_MS;
        fail();
      };
    } catch {
      fail();
    }
  });
  return dbPromise;
}

/**
 * Storage writes are serialised. Without this, a save that is already in flight
 * can land *after* a delete or a version restore and put the old bytes back.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function queueStorageWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function openDatabase(): Promise<IDBDatabase | null> {
  return openAtlasDatabase();
}

function toSummary(record: StoredRecord): MapSummary {
  return {
    id: record.id,
    title: record.title,
    nodeCount: record.nodeCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRecord(doc: MindMapDocument): StoredRecord {
  return {
    id: doc.id,
    title: doc.title,
    nodeCount: Object.keys(doc.nodes).length,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    doc,
  };
}

/** localStorage fallback keeps the app usable where IndexedDB is blocked. */
const fallback = {
  available(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  },
  keys(): string[] {
    if (!this.available()) return [];
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(FALLBACK_PREFIX)) keys.push(key);
    }
    return keys;
  },
  read(key: string): StoredRecord | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as StoredRecord) : null;
    } catch {
      return null;
    }
  },
  /** A write can fail even when `localStorage` exists (quota, private mode). */
  write(key: string, record: StoredRecord): boolean {
    if (!this.available()) return false;
    try {
      localStorage.setItem(key, JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): boolean {
    if (!this.available()) return false;
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Every stored document is re-validated and migrated on read. A corrupt or
 * older-schema record must never reach the store with missing fields.
 */
function readRecord(record: StoredRecord | undefined | null): MindMapDocument | null {
  if (!record || !record.doc) return null;
  try {
    return parseDocument(record.doc);
  } catch (error) {
    // Corrupt records are skipped rather than crashing the app, but never silently.
    console.warn('Atlas: skipped an invalid stored map', error);
    return null;
  }
}

export const mapRepository: MapRepository = {
  async list(): Promise<MapSummary[]> {
    const db = await openDatabase();
    if (!db) {
      return fallback.keys().map((key) => fallback.read(key)).filter((r): r is StoredRecord => !!r)
        .map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => {
        const records = request.result as StoredRecord[];
        resolve(records.map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt));
      };
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error ?? new Error('Listing maps was aborted'));
    });
  },

  async get(id: string): Promise<MindMapDocument | null> {
    const db = await openDatabase();
    if (!db) return readRecord(fallback.read(FALLBACK_PREFIX + id));
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(readRecord(request.result as StoredRecord | undefined));
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error ?? new Error('Reading the map was aborted'));
    });
  },

  async save(doc: MindMapDocument): Promise<MapSummary> {
    const record = toRecord(doc);
    const db = await openDatabase();
    if (!db) {
      // Never report success for a write that did not happen: `persist()` trusts
      // this result to clear the dirty flag.
      if (fallback.write(FALLBACK_PREFIX + doc.id, record)) return toSummary(record);
      throw new Error('Browser storage is unavailable — this map could not be saved');
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(toSummary(record));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Saving the map was aborted'));
    });
  },

  /**
   * Compare-and-swap save. The revision read and the document write happen in
   * one IndexedDB readwrite transaction, so two tabs cannot both pass a stale
   * check and overwrite each other. The localStorage fallback is best-effort:
   * its check and write are not atomic (documented in README).
   */
  async saveAtomic(doc: MindMapDocument, expectedRevision: number): Promise<{ summary: MapSummary; revision: number }> {
    const record = toRecord(doc);
    const db = await openDatabase();
    if (!db) {
      const remote = readRevision(doc.id);
      if (remote > expectedRevision) throw new RevisionConflictError(doc.id, expectedRevision, remote);
      const summary = await mapRepository.save(doc);
      const revision = Math.max(Date.now(), remote + 1, expectedRevision + 1);
      try {
        localStorage.setItem(`${REVISION_PREFIX}${doc.id}`, String(revision));
      } catch {
        /* fallback revisions are best-effort, like the rest of this path */
      }
      return { summary, revision };
    }
    return new Promise((resolve, reject) => {
      let failure: unknown = null;
      const tx = db.transaction([STORE, REVISION_STORE], 'readwrite');
      const revisions = tx.objectStore(REVISION_STORE);
      const request = revisions.get(doc.id);
      request.onsuccess = () => {
        const stored = Number((request.result as { mapId: string; revision: number } | undefined)?.revision ?? 0);
        if (stored > expectedRevision) {
          failure = new RevisionConflictError(doc.id, expectedRevision, stored);
          tx.abort();
          return;
        }
        const revision = Math.max(Date.now(), stored + 1, expectedRevision + 1);
        tx.objectStore(STORE).put(record);
        revisions.put({ mapId: doc.id, revision });
        tx.oncomplete = () => {
          // Keep the synchronous cache used by conflict UI in step with the
          // authoritative IndexedDB revision.
          try {
            localStorage.setItem(`${REVISION_PREFIX}${doc.id}`, String(revision));
          } catch {
            /* localStorage may be blocked; IndexedDB is authoritative */
          }
          resolve({ summary: toSummary(record), revision });
        };
      };
      request.onerror = () => { failure = request.error; };
      tx.onerror = () => { failure ??= tx.error; };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Saving the map was aborted'));
    });
  },

  async remove(id: string): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      fallback.remove(FALLBACK_PREFIX + id);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Deleting the map was aborted'));
    });
  },

  async clear(): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      for (const key of fallback.keys()) fallback.remove(key);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Clearing maps was aborted'));
    });
  },
};

export function readLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_SETTINGS };
    return { ...DEFAULT_LOCAL_SETTINGS, ...(JSON.parse(raw) as Partial<LocalSettings>) };
  } catch {
    return { ...DEFAULT_LOCAL_SETTINGS };
  }
}

export function writeLocalSettings(settings: LocalSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable; settings simply won't persist */
  }
}

/** Creates an independent stored copy. Node ids are document-scoped, so only the map id changes. */
export async function duplicateStoredMap(id: string): Promise<MindMapDocument | null> {
  const source = await mapRepository.get(id);
  if (!source) return null;
  const copy = parseDocument(JSON.parse(JSON.stringify(source)) as unknown);
  const now = Date.now();
  copy.id = uid('map');
  copy.title = `${source.title} (copy)`;
  copy.createdAt = now;
  copy.updatedAt = now;
  await mapRepository.save(copy);
  return copy;
}
