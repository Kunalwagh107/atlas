import { useCallback, useRef, useSyncExternalStore } from 'react';
import { applyCommand, isStructural, type Command } from '../core/commands/commands';
import { commit, createHistory, redo, undo } from '../core/history/history';
import { computeBounds, layoutDocument } from '../core/layout';
import { measureAll } from '../core/layout/measure';
import { getChildren, getVisibleNodes, updateNodes } from '../core/mindmap/operations';
import { DEFAULT_SEARCH_FILTERS, searchDocument, type SearchFilters } from '../core/mindmap/search';
import type { MindMapDocument, MindNode, Point, ThemeKind } from '../core/mindmap/types';
import { readLocalSettings } from '../persistence/indexeddb';
import { clamp, uid } from '../utils/common';
import type { AppState, DialogKind, ResizePreview, SearchState, Selection, UIState, Viewport } from './types';

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.5;

export type Action =
  | { type: 'COMMIT'; command: Command; label: string; coalesceKey?: string; selectCreated?: boolean }
  | { type: 'LOAD'; doc: MindMapDocument; fit?: boolean; markClean?: boolean }
  | { type: 'CLOSE_DOC' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SELECT'; ids: string[]; primaryId?: string | null; focus?: boolean }
  | { type: 'SET_VIEWPORT'; viewport: Viewport }
  | { type: 'PAN_BY'; dx: number; dy: number }
  | { type: 'ZOOM_AT'; factor: number; screen: Point }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'FIT_VIEW' }
  | { type: 'CENTER_VIEW' }
  | { type: 'RESET_VIEW' }
  | { type: 'FOCUS_NODE'; id: string; zoom?: number }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_SEARCH_FILTERS'; filters: Partial<SearchFilters> }
  | { type: 'SEARCH_STEP'; delta: number }
  | { type: 'CLEAR_SEARCH' }
  | { type: 'SET_UI'; patch: Partial<UIState> }
  | { type: 'SET_CANVAS_SIZE'; width: number; height: number }
  | { type: 'SET_THEME'; theme: ThemeKind }
  | { type: 'TOAST'; message: string; tone?: 'info' | 'success' | 'error' }
  | { type: 'BEGIN_DRAG'; label: string }
  | { type: 'DRAG_MOVE'; positions: Record<string, Point> }
  | { type: 'END_DRAG' }
  | { type: 'MARK_SAVED'; at: number }
  | { type: 'TOGGLE_OUTLINE'; id: string }
  | { type: 'SET_FOCUS_ROOT'; id: string | null }
  | { type: 'PRESENTATION_START'; order?: string[] }
  | { type: 'PRESENTATION_STEP'; delta: number }
  | { type: 'PRESENTATION_END' }
  | { type: 'SET_STORAGE_ERROR'; message: string | null }
  | { type: 'SET_IMPORT_ERROR'; error: UIState['importError'] }
  | { type: 'SET_PENDING_ACTION'; action: (() => void) | null }
  | { type: 'RESIZE_PREVIEW'; preview: ResizePreview | null }
  | { type: 'OPEN_RICH_CONTENT' }
  | { type: 'SET_CONFLICT'; conflict: UIState['conflict'] };

function initialUI(): UIState {
  const settings = readLocalSettings();
  return {
    theme: settings.theme,
    showcaseOpen: false,
    sidebarOpen: settings.sidebarOpen,
    sidebarTab: 'inspector',
    dialog: null,
    contextMenu: { open: false, x: 0, y: 0, world: { x: 0, y: 0 }, target: 'canvas', targetId: null },
    editingNodeId: null,
    selectedEdgeId: null,
    linkSourceId: null,
    canvasSize: { width: 1200, height: 720 },
    searchOpen: false,
    toast: null,
    autoSave: settings.autoSave,
    dirty: false,
    savedAt: null,
    lastAction: '',
    showShortcutHints: settings.showShortcutHints,
    clipboard: null,
    collapsedOutline: {},
    pendingDeleteMapId: null,
    linkLabelDraft: '',
    focusRootId: null,
    presentation: { active: false, index: 0, order: [] },
    storageError: null,
    pendingAction: null,
    importError: null,
    contentFocus: 0,
    conflict: null,
  };
}

export function createInitialState(): AppState {
  return {
    history: createHistory<MindMapDocument | null>(null),
    selection: { ids: [], primaryId: null },
    viewport: { x: 600, y: 360, zoom: 1, animated: false },
    search: { query: '', matches: [], activeIndex: -1, results: [], filters: DEFAULT_SEARCH_FILTERS },
    ui: initialUI(),
    transaction: null,
    dragPositions: null,
    resizePreview: null,
  };
}

function visibleSizes(doc: MindMapDocument): ReturnType<typeof measureAll> {
  return measureAll(getVisibleNodes(doc), doc.settings.showDescriptions, doc.rootId);
}

function positionsOf(doc: MindMapDocument): Record<string, Point> {
  const positions: Record<string, Point> = {};
  for (const node of Object.values(doc.nodes)) positions[node.id] = node.position;
  return positions;
}

function fitViewport(state: AppState, doc: MindMapDocument): Viewport {
  const sizes = visibleSizes(doc);
  const ids = getVisibleNodes(doc).map((n) => n.id);
  const bounds = computeBounds(positionsOf(doc), sizes, ids, 90);
  const { width, height } = state.ui.canvasSize;
  const usableW = Math.max(200, width - 40);
  const usableH = Math.max(200, height - 40);
  const zoom = clamp(Math.min(usableW / bounds.width, usableH / bounds.height), MIN_ZOOM, 1.15);
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
    animated: true,
  };
}

function centerOn(state: AppState, doc: MindMapDocument, id: string, minZoom = 0.85): Viewport {
  const node = doc.nodes[id];
  if (!node) return state.viewport;
  const zoom = Math.max(state.viewport.zoom, minZoom);
  return {
    x: state.ui.canvasSize.width / 2 - node.position.x * zoom,
    y: state.ui.canvasSize.height / 2 - node.position.y * zoom,
    zoom,
    animated: true,
  };
}

function searchFor(
  doc: MindMapDocument | null,
  query: string,
  filters: SearchFilters,
  activeIndex = -1,
): SearchState {
  if (!doc || !query.trim()) {
    return { query, matches: [], activeIndex: -1, results: [], filters };
  }
  const results = searchDocument(doc, query, filters);
  const matches = results.map((hit) => hit.id);
  const index = matches.length ? clamp(activeIndex < 0 ? 0 : activeIndex, 0, matches.length - 1) : -1;
  return { query, matches, activeIndex: index, results, filters };
}

function restorePrimary(ids: string[], previous: string | null): string | null {
  return previous && ids.includes(previous) ? previous : (ids[0] ?? null);
}

function validSelection(selection: Selection, doc: MindMapDocument | null): Selection {
  if (!doc) return { ids: [], primaryId: null };
  const ids = selection.ids.filter((id) => !!doc.nodes[id]);
  const primaryId = selection.primaryId && doc.nodes[selection.primaryId] ? selection.primaryId : (ids[0] ?? null);
  return { ids, primaryId };
}

/** Depth-first order used by Presentation Mode when the author has not defined one. */
export function depthFirstOrder(doc: MindMapDocument): string[] {
  const order: string[] = [];
  const walk = (id: string) => {
    if (!doc.nodes[id]) return;
    order.push(id);
    for (const child of getChildren(doc, id)) walk(child.id);
  };
  walk(doc.rootId);
  return order;
}

function resolvePresentationOrder(doc: MindMapDocument, explicit: string[]): string[] {
  const valid = explicit.filter((id) => !!doc.nodes[id]);
  return valid.length ? valid : depthFirstOrder(doc);
}

/**
 * Auto-arrange is opt-in per document. It re-runs layout after structural edits
 * only, and re-places every node — a hand-placed node left pinned would overlap
 * whatever the layout puts next to it.
 */
function maybeArrange(doc: MindMapDocument, command: Command): MindMapDocument {
  if (!doc.settings.autoArrange) return doc;
  if (command.kind === 'replaceDocument' || command.kind === 'applyLayout') return doc;
  if (!isStructural(command)) return doc;
  const sizes = measureAll(Object.values(doc.nodes), doc.settings.showDescriptions, doc.rootId);
  return layoutDocument(doc, sizes, doc.settings.layout, { forceAll: true });
}

/**
 * The document revision that is known to be on disk. Undo/redo compare against
 * it so stepping back to the saved state stops claiming there are unsaved edits.
 * (A single store owns this; it is updated by the same actions that change
 * persistence state.)
 */
let savedDoc: MindMapDocument | null = null;

export function reducer(state: AppState, action: Action): AppState {
  const doc = state.history.present;

  switch (action.type) {
    case 'COMMIT': {
      if (!doc) return state;
      const result = applyCommand(doc, action.command);
      if (!result.changed) return state;
      const arranged = maybeArrange(result.doc, action.command);
      const history = commit(state.history, arranged, {
        label: action.label,
        coalesceKey: action.coalesceKey,
        selectionIds: state.selection.ids,
      });
      const primaryId = action.selectCreated && result.createdId ? result.createdId : state.selection.primaryId;
      const selection = validSelection(
        {
          ids: action.selectCreated && result.createdId ? [result.createdId] : state.selection.ids,
          primaryId,
        },
        arranged,
      );
      return {
        ...state,
        history,
        selection,
        search: searchFor(arranged, state.search.query, state.search.filters, state.search.activeIndex),
        ui: { ...state.ui, dirty: true, lastAction: action.label, contextMenu: { ...state.ui.contextMenu, open: false } },
      };
    }
    case 'LOAD': {
      savedDoc = action.markClean === false ? null : action.doc;
      const history = createHistory<MindMapDocument | null>(action.doc);
      const clean = action.markClean !== false;
      const next: AppState = {
        ...state,
        history,
        selection: { ids: [action.doc.rootId], primaryId: action.doc.rootId },
        search: { query: '', matches: [], activeIndex: -1, results: [], filters: state.search.filters },
        transaction: null,
        dragPositions: null,
        resizePreview: null,
        ui: {
          ...state.ui,
          dirty: !clean,
          savedAt: clean ? Date.now() : null,
          dialog: null,
          editingNodeId: null,
          selectedEdgeId: null,
          linkSourceId: null,
          contextMenu: { ...state.ui.contextMenu, open: false },
          lastAction: 'Opened map',
          focusRootId: null,
          presentation: { active: false, index: 0, order: [] },
          importError: null,
          conflict: null,
        },
      };
      return { ...next, viewport: action.fit === false ? state.viewport : fitViewport(next, action.doc) };
    }
    case 'CLOSE_DOC':
      savedDoc = null;
      return {
        ...state,
        history: createHistory<MindMapDocument | null>(null),
        transaction: null,
        dragPositions: null,
        resizePreview: null,
        selection: { ids: [], primaryId: null },
        search: { query: '', matches: [], activeIndex: -1, results: [], filters: state.search.filters },
        ui: { ...state.ui, dirty: false, dialog: 'new', focusRootId: null, presentation: { active: false, index: 0, order: [] }, conflict: null },
      };
    case 'UNDO': {
      if (!state.history.past.length) return state;
      const entry = state.history.past[state.history.past.length - 1];
      const history = undo(state.history, { selectionIds: state.selection.ids });
      const ids = entry.selectionIds ?? state.selection.ids;
      return {
        ...state,
        history,
        selection: validSelection({ ids, primaryId: restorePrimary(ids, state.selection.primaryId) }, history.present),
        search: searchFor(history.present, state.search.query, state.search.filters, state.search.activeIndex),
        ui: { ...state.ui, dirty: savedDoc ? history.present !== savedDoc : true, lastAction: history.lastAction },
      };
    }
    case 'REDO': {
      if (!state.history.future.length) return state;
      const entry = state.history.future[state.history.future.length - 1];
      const history = redo(state.history, { selectionIds: state.selection.ids });
      const ids = entry.selectionIds ?? state.selection.ids;
      return {
        ...state,
        history,
        selection: validSelection({ ids, primaryId: restorePrimary(ids, state.selection.primaryId) }, history.present),
        search: searchFor(history.present, state.search.query, state.search.filters, state.search.activeIndex),
        ui: { ...state.ui, dirty: savedDoc ? history.present !== savedDoc : true, lastAction: history.lastAction },
      };
    }
    case 'SELECT': {
      const selection = validSelection(
        { ids: action.ids, primaryId: action.primaryId === undefined ? (action.ids[0] ?? null) : action.primaryId },
        doc,
      );
      const viewport = action.focus && selection.primaryId && doc
        ? centerOn(state, doc, selection.primaryId, Math.min(state.viewport.zoom, 1))
        : state.viewport;
      return {
        ...state,
        selection,
        viewport,
        ui: { ...state.ui, selectedEdgeId: null, contextMenu: { ...state.ui.contextMenu, open: false } },
      };
    }
    case 'SET_VIEWPORT':
      return { ...state, viewport: action.viewport };
    case 'PAN_BY':
      return {
        ...state,
        viewport: { ...state.viewport, x: state.viewport.x + action.dx, y: state.viewport.y + action.dy, animated: false },
      };
    case 'ZOOM_AT': {
      const zoom = clamp(state.viewport.zoom * action.factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = zoom / state.viewport.zoom;
      return {
        ...state,
        viewport: {
          x: action.screen.x - (action.screen.x - state.viewport.x) * ratio,
          y: action.screen.y - (action.screen.y - state.viewport.y) * ratio,
          zoom,
          animated: false,
        },
      };
    }
    case 'SET_ZOOM': {
      const zoom = clamp(action.zoom, MIN_ZOOM, MAX_ZOOM);
      const center = { x: state.ui.canvasSize.width / 2, y: state.ui.canvasSize.height / 2 };
      const ratio = zoom / state.viewport.zoom;
      return {
        ...state,
        viewport: {
          x: center.x - (center.x - state.viewport.x) * ratio,
          y: center.y - (center.y - state.viewport.y) * ratio,
          zoom,
          animated: true,
        },
      };
    }
    case 'FIT_VIEW':
      return doc ? { ...state, viewport: fitViewport(state, doc) } : state;
    case 'CENTER_VIEW':
      return doc ? { ...state, viewport: centerOn(state, doc, doc.rootId, state.viewport.zoom) } : state;
    case 'RESET_VIEW':
      return { ...state, viewport: { ...state.viewport, zoom: 1, animated: true, x: state.ui.canvasSize.width / 2, y: state.ui.canvasSize.height / 2 } };
    case 'FOCUS_NODE': {
      if (!doc || !doc.nodes[action.id]) return state;
      return {
        ...state,
        selection: { ids: [action.id], primaryId: action.id },
        viewport: centerOn(state, doc, action.id, action.zoom ?? 0.9),
      };
    }
    case 'SET_SEARCH':
      return { ...state, search: searchFor(doc, action.query, state.search.filters, 0) };
    case 'SET_SEARCH_FILTERS': {
      const filters: SearchFilters = { ...state.search.filters, ...action.filters };
      return { ...state, search: searchFor(doc, state.search.query, filters, state.search.activeIndex) };
    }
    case 'SEARCH_STEP': {
      const { matches, query, activeIndex, results, filters } = state.search;
      if (!matches.length || !doc) return state;
      const nextIndex = (activeIndex + action.delta + matches.length) % matches.length;
      return {
        ...state,
        search: { query, matches, activeIndex: nextIndex, results, filters },
        selection: { ids: [matches[nextIndex]], primaryId: matches[nextIndex] },
        viewport: centerOn(state, doc, matches[nextIndex], 0.9),
      };
    }
    case 'CLEAR_SEARCH':
      return {
        ...state,
        search: { query: '', matches: [], activeIndex: -1, results: [], filters: state.search.filters },
        ui: { ...state.ui, searchOpen: false },
      };
    case 'SET_UI':
      return { ...state, ui: { ...state.ui, ...action.patch } };
    case 'SET_CANVAS_SIZE':
      return { ...state, ui: { ...state.ui, canvasSize: { width: action.width, height: action.height } } };
    case 'SET_THEME':
      return { ...state, ui: { ...state.ui, theme: action.theme } };
    case 'TOAST':
      return {
        ...state,
        ui: {
          ...state.ui,
          toast: { id: uid('toast'), message: action.message, tone: action.tone ?? 'info' },
        },
      };
    case 'BEGIN_DRAG':
      return doc
        ? { ...state, transaction: { before: doc, label: action.label }, dragPositions: {} }
        : state;
    case 'DRAG_MOVE': {
      // Transient only. Keeping the document untouched per frame means the derived
      // context, history and autosave do not churn while the pointer moves.
      if (!state.transaction) return state;
      return { ...state, dragPositions: action.positions };
    }
    case 'END_DRAG': {
      if (!state.transaction) return state;
      const { label } = state.transaction;
      const current = state.history.present;
      const patches: Record<string, Partial<MindNode>> = {};
      for (const [id, position] of Object.entries(state.dragPositions ?? {})) {
        if (current?.nodes[id]) patches[id] = { position, positionMode: 'manual' };
      }
      const changed = !!current && Object.keys(patches).length > 0;
      const moved = changed ? updateNodes(current!, patches, false) : current;
      const history = moved && moved !== state.history.present
        ? commit(state.history, moved, { label, selectionIds: state.selection.ids })
        : state.history;
      return {
        ...state,
        history,
        transaction: null,
        dragPositions: null,
        ui: { ...state.ui, dirty: changed || state.ui.dirty, lastAction: label },
      };
    }
    case 'MARK_SAVED':
      savedDoc = state.history.present;
      return { ...state, ui: { ...state.ui, dirty: false, savedAt: action.at, storageError: null } };
    case 'TOGGLE_OUTLINE':
      return {
        ...state,
        ui: {
          ...state.ui,
          collapsedOutline: { ...state.ui.collapsedOutline, [action.id]: !state.ui.collapsedOutline[action.id] },
        },
      };
    case 'SET_FOCUS_ROOT': {
      if (!doc) return state;
      const nextRoot = action.id && doc.nodes[action.id] ? action.id : null;
      return {
        ...state,
        ui: { ...state.ui, focusRootId: nextRoot, contextMenu: { ...state.ui.contextMenu, open: false } },
        selection: nextRoot ? { ids: [nextRoot], primaryId: nextRoot } : state.selection,
        viewport: nextRoot ? centerOn(state, doc, nextRoot, 0.95) : state.viewport,
      };
    }
    case 'PRESENTATION_START': {
      if (!doc) return state;
      const order = resolvePresentationOrder(doc, action.order ?? doc.settings.presentationOrder);
      if (!order.length) return state;
      return {
        ...state,
        ui: { ...state.ui, presentation: { active: true, index: 0, order }, dialog: null, focusRootId: null },
        selection: { ids: [order[0]], primaryId: order[0] },
        viewport: centerOn(state, doc, order[0], 1),
      };
    }
    case 'PRESENTATION_STEP': {
      if (!doc || !state.ui.presentation.active) return state;
      const { order, index } = state.ui.presentation;
      if (!order.length) return state;
      const nextIndex = clamp(index + action.delta, 0, order.length - 1);
      const target = order[nextIndex];
      return {
        ...state,
        ui: { ...state.ui, presentation: { ...state.ui.presentation, index: nextIndex } },
        selection: doc.nodes[target] ? { ids: [target], primaryId: target } : state.selection,
        viewport: doc.nodes[target] ? centerOn(state, doc, target, 1) : state.viewport,
      };
    }
    case 'PRESENTATION_END':
      return { ...state, ui: { ...state.ui, presentation: { active: false, index: 0, order: [] } } };
    case 'SET_STORAGE_ERROR':
      return { ...state, ui: { ...state.ui, storageError: action.message } };
    case 'SET_IMPORT_ERROR':
      return { ...state, ui: { ...state.ui, importError: action.error } };
    case 'SET_PENDING_ACTION':
      return { ...state, ui: { ...state.ui, pendingAction: action.action } };
    case 'RESIZE_PREVIEW':
      return { ...state, resizePreview: action.preview };
    case 'OPEN_RICH_CONTENT':
      return {
        ...state,
        ui: {
          ...state.ui,
          sidebarOpen: true,
          sidebarTab: 'inspector',
          contentFocus: state.ui.contentFocus + 1,
          contextMenu: { ...state.ui.contextMenu, open: false },
        },
      };
    case 'SET_CONFLICT':
      return { ...state, ui: { ...state.ui, conflict: action.conflict } };
    default:
      return state;
  }
}

class Store {
  private state: AppState = createInitialState();
  private listeners = new Set<() => void>();

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch = (action: Action): void => {
    const next = reducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  };
}

export const store = new Store();

/** Selector-based subscription: components only re-render when their slice changes. */
export function useAppStore<T>(
  selector: (state: AppState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalRef = useRef(isEqual);
  equalRef.current = isEqual;
  const cache = useRef<{ state: AppState; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const current = store.getState();
    const last = cache.current;
    if (last && last.state === current) return last.value;
    const value = selectorRef.current(current);
    if (last && equalRef.current(last.value, value)) {
      cache.current = { state: current, value: last.value };
      return last.value;
    }
    cache.current = { state: current, value };
    return value;
  }, []);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useDialog(): DialogKind {
  return useAppStore((s) => s.ui.dialog);
}

export const shallowArrayEqual = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
