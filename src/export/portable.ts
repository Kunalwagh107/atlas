import type { MindMapDocument } from '../core/mindmap/types';
import { parseDocument } from '../core/mindmap/validation';
import { backupChecksum } from './backup';

/**
 * Single-map portable format. The file embeds uploaded images as data URLs and
 * carries an integrity checksum, so it can move a map between browsers/devices
 * without any server.
 */
export const PORTABLE_FORMAT = 'atlas-map';
export const PORTABLE_VERSION = 1;

export class PortableMapError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'PortableMapError';
    this.details = details;
  }
}

export function serializePortableMap(doc: MindMapDocument, exportedAt = new Date()): string {
  return JSON.stringify({
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: exportedAt.toISOString(),
    integrity: backupChecksum(doc),
    doc,
  }, null, 2);
}

function asRecord(text: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PortableMapError('This file is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PortableMapError('This is not an Atlas map file.');
  }
  return raw as Record<string, unknown>;
}

/** True only for the wrapper shape, so legacy plain-document JSON still imports. */
export function isPortableMapText(text: string): boolean {
  try {
    return asRecord(text).format === PORTABLE_FORMAT;
  } catch {
    return false;
  }
}

export function parsePortableMap(text: string): MindMapDocument {
  const file = asRecord(text);
  if (file.format !== PORTABLE_FORMAT) throw new PortableMapError('This is not an Atlas map file.');
  const version = Number(file.version);
  if (!Number.isFinite(version) || version < 1) throw new PortableMapError('This map file has no usable version.');
  if (version > PORTABLE_VERSION) throw new PortableMapError('This map was made by a newer version of Atlas. Update the app and try again.');
  if (typeof file.integrity !== 'string') throw new PortableMapError('This map file has no integrity checksum.');
  const actual = backupChecksum(file.doc);
  if (actual !== file.integrity) {
    throw new PortableMapError('This map file failed its integrity check and may have been corrupted.', [
      `Expected ${file.integrity}, got ${actual}.`,
    ]);
  }
  try {
    return parseDocument(file.doc);
  } catch (error) {
    throw new PortableMapError(
      'This map file contains an invalid document.',
      [error instanceof Error ? error.message : 'Unknown validation failure'],
    );
  }
}
