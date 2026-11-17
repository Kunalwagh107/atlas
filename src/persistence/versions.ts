import { parseDocument } from '../core/mindmap/validation';
import type { MindMapDocument } from '../core/mindmap/types';
import { uid } from '../utils/common';
import { VERSION_STORE, openAtlasDatabase, queueStorageWrite } from './indexeddb';

/**
 * Persistent version history. Snapshots are full document copies (so a restore is
 * exact, including manual positions and collapsed branches) stored separately from
 * the current map record. They survive reloads and are pruned by a fixed policy.
 */

export type VersionKind = 'auto' | 'named';

export interface VersionSnapshot {
  id: string;
  mapId: string;
  label: string;
  kind: VersionKind;
  createdAt: number;
  nodeCount: number;
  /** Content hash, used to avoid storing identical consecutive auto snapshots. */
  fingerprint: string;
  doc: MindMapDocument;
}

export type VersionSummary = Omit<VersionSnapshot, 'doc' | 'fingerprint'> & { fingerprint: string };

export interface VersionPolicy {
  /** Maximum number of automatic snapshots kept per map. */
  maxAuto: number;
  /** Maximum number of explicitly named snapshots kept per map. */
  maxNamed: number;
  /** Minimum gap between automatic snapshots. */
  minIntervalMs: number;
}

export const DEFAULT_VERSION_POLICY: VersionPolicy = {
  maxAuto: 40,
  maxNamed: 60,
  minIntervalMs: 45_000,
};

const FALLBACK_PREFIX = 'atlas:version:';
const FALLBACK_AUTO_LIMIT = 12;

/** FNV-1a over the meaningful document content; volatile timestamps are excluded. */
export function documentFingerprint(doc: MindMapDocument): string {
  const value = JSON.stringify({
    title: doc.title,
    rootId: doc.rootId,
    nodes: doc.nodes,
    edges: doc.edges,
    settings: doc.settings,
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function toSummary(record: VersionSnapshot): VersionSummary {
  return {
    id: record.id,
    mapId: record.mapId,
    label: record.label,
    kind: record.kind,
    createdAt: record.createdAt,
    nodeCount: record.nodeCount,
    fingerprint: record.fingerprint,
  };
}

function fallbackRecords(): VersionSnapshot[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const out: VersionSnapshot[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(FALLBACK_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          out.push(JSON.parse(raw) as VersionSnapshot);
        } catch {
          /* skip a corrupted record */
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function fallbackWrite(record: VersionSnapshot): void {
  try {
    localStorage.setItem(FALLBACK_PREFIX + record.id, JSON.stringify(record));
  } catch {
    /* quota exhausted — the snapshot is simply not persisted */
  }
}

function fallbackRemove(id: string): void {
  try {
    localStorage.removeItem(FALLBACK_PREFIX + id);
  } catch {
    /* ignore */
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Version transaction aborted'));
  });
}

async function allForMap(mapId: string): Promise<VersionSnapshot[]> {
  const db = await openAtlasDatabase();
  if (!db) return fallbackRecords().filter((record) => record.mapId === mapId);
  const tx = db.transaction(VERSION_STORE, 'readonly');
  const records = await requestToPromise(
    tx.objectStore(VERSION_STORE).index('mapId').getAll(IDBKeyRange.only(mapId)) as IDBRequest<VersionSnapshot[]>,
  );
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export interface SaveVersionOptions {
  label?: string;
  kind?: VersionKind;
  policy?: Partial<VersionPolicy>;
  /** Bypass the time throttle and deduplication (used by "Save snapshot now"). */
  force?: boolean;
}

/**
 * Read-modify-write bodies. They are only ever called from inside
 * `queueStorageWrite`, so two concurrent snapshots can never both read the same
 * "newest" record, and a prune can never delete from a stale list.
 */
async function saveUnlocked(
  doc: MindMapDocument,
  options: SaveVersionOptions,
): Promise<VersionSummary | null> {
  const policy: VersionPolicy = { ...DEFAULT_VERSION_POLICY, ...options.policy };
  const kind = options.kind ?? 'named';
  const fingerprint = documentFingerprint(doc);
  const existing = await allForMap(doc.id);
  const newest = existing[0];

  if (!options.force && kind === 'auto') {
    if (newest?.fingerprint === fingerprint) return null;
    if (newest?.kind === 'auto' && Date.now() - newest.createdAt < policy.minIntervalMs) return null;
  }

  const record: VersionSnapshot = {
    id: uid('ver'),
    mapId: doc.id,
    label: options.label?.trim() || (kind === 'named' ? `Snapshot · ${doc.title}` : 'Auto-save'),
    kind,
    createdAt: Date.now(),
    nodeCount: Object.keys(doc.nodes).length,
    fingerprint,
    doc: JSON.parse(JSON.stringify(doc)) as MindMapDocument,
  };

  const db = await openAtlasDatabase();
  if (!db) fallbackWrite(record);
  else {
    const tx = db.transaction(VERSION_STORE, 'readwrite');
    tx.objectStore(VERSION_STORE).put(record);
    await txDone(tx);
  }
  await pruneUnlocked(doc.id, policy);
  return toSummary(record);
}

async function clearUnlocked(mapId: string): Promise<void> {
  const records = await allForMap(mapId);
  const db = await openAtlasDatabase();
  if (!db) {
    records.forEach((record) => fallbackRemove(record.id));
    return;
  }
  const tx = db.transaction(VERSION_STORE, 'readwrite');
  const store = tx.objectStore(VERSION_STORE);
  records.forEach((record) => store.delete(record.id));
  await txDone(tx);
}

/** Retention: keep the newest N per kind; named snapshots are never auto-pruned below 1. */
async function pruneUnlocked(mapId: string, policy: Partial<VersionPolicy>): Promise<number> {
  const limits = { ...DEFAULT_VERSION_POLICY, ...policy };
  const db = await openAtlasDatabase();
  const records = await allForMap(mapId);
  const capAuto = !db ? FALLBACK_AUTO_LIMIT : limits.maxAuto;
  const seen: Record<VersionKind, number> = { auto: 0, named: 0 };
  const doomed: string[] = [];
  for (const record of records) {
    const cap = record.kind === 'named' ? limits.maxNamed : capAuto;
    seen[record.kind]++;
    if (seen[record.kind] > cap) doomed.push(record.id);
  }
  if (!doomed.length) return 0;
  if (!db) doomed.forEach(fallbackRemove);
  else {
    const tx = db.transaction(VERSION_STORE, 'readwrite');
    const store = tx.objectStore(VERSION_STORE);
    doomed.forEach((id) => store.delete(id));
    await txDone(tx);
  }
  return doomed.length;
}

export const versionRepository = {
  /** Newest first. Corrupted IndexedDB records are skipped rather than crashing the UI. */
  async list(mapId: string): Promise<VersionSummary[]> {
    const records = await allForMap(mapId);
    return records.filter((record) => !!record?.doc).map(toSummary);
  },

  /** Returns a validated document, or null when the snapshot is missing/corrupt. */
  async get(id: string): Promise<MindMapDocument | null> {
    const db = await openAtlasDatabase();
    let record: VersionSnapshot | undefined;
    if (!db) record = fallbackRecords().find((item) => item.id === id);
    else {
      const tx = db.transaction(VERSION_STORE, 'readonly');
      record = await requestToPromise(
        tx.objectStore(VERSION_STORE).get(id) as IDBRequest<VersionSnapshot | undefined>,
      );
    }
    if (!record?.doc) return null;
    try {
      return parseDocument(record.doc);
    } catch {
      return null;
    }
  },

  /**
   * Store a snapshot. Automatic snapshots are throttled and deduplicated; named
   * snapshots always create a new entry. Returns null when the write was skipped.
   */
  save(doc: MindMapDocument, options: SaveVersionOptions = {}): Promise<VersionSummary | null> {
    return queueStorageWrite(() => saveUnlocked(doc, options));
  },

  async rename(id: string, label: string): Promise<void> {
    const clean = label.trim().slice(0, 120);
    if (!clean) return;
    await queueStorageWrite(async () => {
      const db = await openAtlasDatabase();
      if (!db) {
        const record = fallbackRecords().find((item) => item.id === id);
        if (record) fallbackWrite({ ...record, label: clean, kind: 'named' });
        return;
      }
      const tx = db.transaction(VERSION_STORE, 'readwrite');
      const store = tx.objectStore(VERSION_STORE);
      const record = await requestToPromise(store.get(id) as IDBRequest<VersionSnapshot | undefined>);
      if (record) store.put({ ...record, label: clean, kind: 'named' });
      await txDone(tx);
    });
  },

  async remove(id: string): Promise<void> {
    await queueStorageWrite(async () => {
      const db = await openAtlasDatabase();
      if (!db) {
        fallbackRemove(id);
        return;
      }
      const tx = db.transaction(VERSION_STORE, 'readwrite');
      tx.objectStore(VERSION_STORE).delete(id);
      await txDone(tx);
    });
  },

  /** Remove every snapshot belonging to a map (called when a map is deleted). */
  clear(mapId: string): Promise<void> {
    return queueStorageWrite(() => clearUnlocked(mapId));
  },

  prune(mapId: string, policy: Partial<VersionPolicy> = {}): Promise<number> {
    return queueStorageWrite(() => pruneUnlocked(mapId, policy));
  },
};
