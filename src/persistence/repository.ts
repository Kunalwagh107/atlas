import type { MapSummary, MindMapDocument } from '../core/mindmap/types';

/**
 * Persistence contract. The IndexedDB implementation can be swapped for a remote
 * backend without touching the state layer — every method is async for that reason.
 */
export interface MapRepository {
  list(): Promise<MapSummary[]>;
  get(id: string): Promise<MindMapDocument | null>;
  save(doc: MindMapDocument): Promise<MapSummary>;
  /** Compare-and-swap write: rejects when another save claimed a newer revision. */
  saveAtomic(doc: MindMapDocument, expectedRevision: number): Promise<{ summary: MapSummary; revision: number }>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface LocalSettings {
  theme: 'light' | 'dark';
  lastMapId: string | null;
  autoSave: boolean;
  sidebarOpen: boolean;
  showShortcutHints: boolean;
}

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  theme: 'light',
  lastMapId: null,
  autoSave: true,
  sidebarOpen: true,
  showShortcutHints: true,
};
