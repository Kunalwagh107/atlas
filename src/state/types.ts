import type { HistoryState } from '../core/history/history';
import type { SubtreePayload } from '../core/mindmap/operations';
import type { SearchFilters, SearchHit } from '../core/mindmap/search';
import type { MindMapDocument, Point, ThemeKind } from '../core/mindmap/types';

/** Transient geometry while a corner handle is being dragged. */
export interface ResizePreview {
  id: string;
  width: number;
  height: number;
  /** Keeping the opposite corner fixed means the centre shifts slightly. */
  position: Point;
}

/** Screen = world * zoom + (x, y). */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  animated: boolean;
}

export interface Selection {
  ids: string[];
  primaryId: string | null;
}

export type DialogKind =
  | null
  | 'new'
  | 'open'
  | 'saveAs'
  | 'rename'
  | 'export'
  | 'settings'
  | 'shortcuts'
  | 'import'
  | 'about'
  | 'deleteConfirm'
  | 'history'
  | 'presentation'
  | 'gif'
  | 'unsaved'
  | 'importError';

export type ContextTarget = 'node' | 'canvas' | 'edge';

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  world: Point;
  target: ContextTarget;
  targetId: string | null;
}

export interface ToastState {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
}

/**
 * Another tab saved this map. Writes are blocked until the user chooses to keep
 * a local copy, reload the other tab's version, or explicitly overwrite it.
 */
export interface ConflictState {
  mapId: string;
  /** Revision written by the other tab. */
  remoteRevision: number;
  /** The other tab's map title, for the warning copy. */
  title: string;
  /** This tab has unsaved edits that are at risk. */
  dirty: boolean;
  at: number;
}

export interface PresentationState {
  active: boolean;
  index: number;
  /** Empty means derive depth-first order from the tree. */
  order: string[];
}

export interface UIState {
  theme: ThemeKind;
  /** The in-app product tour replaces the canvas workspace until closed. */
  showcaseOpen: boolean;
  sidebarOpen: boolean;
  sidebarTab: 'inspector' | 'outline' | 'history';
  dialog: DialogKind;
  contextMenu: ContextMenuState;
  editingNodeId: string | null;
  selectedEdgeId: string | null;
  linkSourceId: string | null;
  canvasSize: { width: number; height: number };
  searchOpen: boolean;
  toast: ToastState | null;
  autoSave: boolean;
  dirty: boolean;
  savedAt: number | null;
  lastAction: string;
  showShortcutHints: boolean;
  clipboard: SubtreePayload | null;
  collapsedOutline: Record<string, boolean>;
  pendingDeleteMapId: string | null;
  linkLabelDraft: string;
  focusRootId: string | null;
  presentation: PresentationState;
  /** Last storage failure, surfaced in the status bar instead of being silently dropped. */
  storageError: string | null;
  /** Deferred action awaiting the unsaved-changes decision. */
  pendingAction: (() => void) | null;
  importError: { message: string; details: string[]; filename: string } | null;
  /** Incremented when "Rich content" is requested so the Inspector scrolls to it. */
  contentFocus: number;
  /** Non-null while another tab holds a newer revision of the open map. */
  conflict: ConflictState | null;
}

export interface SearchState {
  query: string;
  matches: string[];
  activeIndex: number;
  results: SearchHit[];
  filters: SearchFilters;
}

export interface AppState {
  history: HistoryState<MindMapDocument | null>;
  selection: Selection;
  viewport: Viewport;
  search: SearchState;
  ui: UIState;
  transaction: { before: MindMapDocument; label: string } | null;
  /** Transient positions while dragging: deliberately NOT part of history/doc. */
  dragPositions: Record<string, Point> | null;
  /** Transient size/position while a corner resize handle is dragged. */
  resizePreview: ResizePreview | null;
}
