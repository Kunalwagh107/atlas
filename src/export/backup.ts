import type { MindMapDocument } from '../core/mindmap/types';
import { parseDocument } from '../core/mindmap/validation';

/**
 * Whole-library backup. Maps live in this browser's IndexedDB, so moving them to
 * another device means exporting every map into one file and restoring it there.
 * Restoring always creates copies — it never overwrites an existing map.
 *
 * v2 adds a checksum per map. Generation and validation use the same rules, so
 * any file we successfully write can be read back. There is no arbitrary map
 * count or byte limit; failed maps are reported and skipped individually.
 */

export const BACKUP_FORMAT = 'atlas-backup';
export const BACKUP_VERSION = 2;

export interface BackupEntry {
  id: string;
  title: string;
  updatedAt: number;
  doc: MindMapDocument;
  /** Present in v2; FNV-1a of the raw document JSON. */
  integrity?: string;
}

export class BackupError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'BackupError';
    this.details = details;
  }
}

/** Stable, dependency-free checksum used for backup integrity checks. */
export function backupChecksum(value: unknown): string {
  const json = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index++) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function serializeBackup(maps: MindMapDocument[], exportedAt = new Date()): string {
  const entries: BackupEntry[] = maps.map((doc) => ({
    id: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    doc,
    integrity: backupChecksum(doc),
  }));
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: exportedAt.toISOString(),
      maps: entries,
    },
    null,
    2,
  );
}

/**
 * Validate the envelope, version and every map. A single unreadable map is
 * reported and skipped rather than failing the whole restore; a tampered v2
 * entry is treated as corrupt and skipped with a clear diagnostic.
 */
export function parseBackup(text: string): MindMapDocument[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BackupError('This is not an Atlas backup file.');
  }
  const file = raw as Record<string, unknown>;
  if (file.format !== BACKUP_FORMAT) {
    throw new BackupError('This is not an Atlas backup file.', ['Expected "format": "atlas-backup".']);
  }
  const version = Number(file.version);
  if (!Number.isFinite(version) || version < 1) {
    throw new BackupError('This backup has no usable version number.');
  }
  if (version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of Atlas. Update the app and try again.');
  }
  if (!Array.isArray(file.maps) || file.maps.length === 0) {
    throw new BackupError('This backup contains no maps.');
  }

  const docs: MindMapDocument[] = [];
  const issues: string[] = [];
  file.maps.forEach((entry, index) => {
    const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const rawDoc = record.doc ?? record;
    if (version >= 2) {
      if (typeof record.integrity !== 'string') {
        issues.push(`Map ${index + 1}: missing integrity checksum`);
        return;
      }
      const actual = backupChecksum(rawDoc);
      if (actual !== record.integrity) {
        issues.push(`Map ${index + 1}: integrity check failed (expected ${record.integrity}, got ${actual})`);
        return;
      }
    }
    try {
      docs.push(parseDocument(rawDoc));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid document';
      issues.push(`Map ${index + 1}: ${reason}`);
    }
  });
  if (!docs.length) {
    throw new BackupError('None of the maps in this backup could be read.', issues);
  }
  if (issues.length) Object.assign(docs, { issues });
  return docs;
}
