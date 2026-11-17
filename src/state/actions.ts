import type { AlignMode, Command } from '../core/commands/commands';
import { measureAll } from '../core/layout/measure';
import { extractSubtree, getChildren, isVisible, type NodePatch } from '../core/mindmap/operations';
import type { SearchFilters } from '../core/mindmap/search';
import type {
  LayoutKind,
  MindMapDocument,
  MindNode,
  NodeContent,
  NodeStyle,
  Point,
  ThemeKind,
} from '../core/mindmap/types';
import { store } from './store';
import type { DialogKind, ResizePreview, UIState } from './types';

function doc(): MindMapDocument | null {
  return store.getState().history.present;
}

function selectedId(): string | null {
  return store.getState().selection.primaryId;
}

function run(command: Command, label: string, options: { coalesceKey?: string; selectCreated?: boolean } = {}): string | null {
  store.dispatch({ type: 'COMMIT', command, label, ...options });
  return options.selectCreated ? store.getState().selection.primaryId : null;
}

export const actions = {
  /* ---------- document lifecycle ---------- */
  load(next: MindMapDocument, fit = true, markClean = true): void {
    store.dispatch({ type: 'LOAD', doc: next, fit, markClean });
  },
  closeDoc(): void {
    store.dispatch({ type: 'CLOSE_DOC' });
  },
  markSaved(): void {
    store.dispatch({ type: 'MARK_SAVED', at: Date.now() });
  },
  run,
  undo(): void {
    store.dispatch({ type: 'UNDO' });
  },
  redo(): void {
    store.dispatch({ type: 'REDO' });
  },

  /* ---------- nodes ---------- */
  addChild(parentId?: string, init?: Partial<MindNode>): void {
    const current = doc();
    if (!current) return;
    const parent = parentId ?? selectedId() ?? current.rootId;
    const created = run({ kind: 'addChild', parentId: parent, init }, 'Add child node', { selectCreated: true });
    if (created) actions.setEditing(created);
  },
  addSibling(): void {
    const current = doc();
    if (!current) return;
    const id = selectedId() ?? current.rootId;
    const created = run({ kind: 'addSibling', nodeId: id }, 'Add sibling node', { selectCreated: true });
    if (created) actions.setEditing(created);
  },
  addNodeAt(position: Point): void {
    const current = doc();
    if (!current) return;
    const created = run(
      { kind: 'addChild', parentId: current.rootId, init: { position } },
      'Add node',
      { selectCreated: true },
    );
    if (created) actions.setEditing(created);
  },
  deleteSelected(): void {
    const current = doc();
    const id = selectedId();
    if (!current || !id || id === current.rootId) {
      actions.toast('The central topic cannot be deleted', 'error');
      return;
    }
    run({ kind: 'deleteNode', id }, 'Delete node');
    actions.select([current.rootId]);
  },
  deleteNode(id: string): void {
    const current = doc();
    if (!current || id === current.rootId) return;
    run({ kind: 'deleteNode', id }, 'Delete node');
    actions.select([current.rootId]);
  },
  /** Bulk delete for multi-selection; the root is never removed. */
  deleteNodes(ids: string[]): void {
    const current = doc();
    if (!current) return;
    const removable = ids.filter((id) => id !== current.rootId && !!current.nodes[id]);
    if (!removable.length) {
      actions.toast('The central topic cannot be deleted', 'error');
      return;
    }
    run({ kind: 'deleteNodes', ids: removable }, removable.length > 1 ? `Delete ${removable.length} nodes` : 'Delete node');
    actions.select([current.rootId]);
  },
  duplicateSelected(): void {
    const id = selectedId();
    const current = doc();
    if (!current || !id || id === current.rootId) return;
    run({ kind: 'duplicateNode', id }, 'Duplicate branch', { selectCreated: true });
  },
  duplicateNode(id: string): void {
    run({ kind: 'duplicateNode', id }, 'Duplicate branch', { selectCreated: true });
  },
  editNode(id: string, patch: NodePatch, label = 'Edit node'): void {
    run({ kind: 'updateNode', id, patch }, label);
  },
  updateContent(id: string, content: NodeContent, label = 'Edit node content'): void {
    run({ kind: 'updateContent', id, content }, label, { coalesceKey: `content:${id}` });
  },
  patchContent(id: string, patch: Partial<NodeContent>, label = 'Edit node content'): void {
    const current = doc();
    const node = current?.nodes[id];
    if (!node) return;
    actions.updateContent(id, { ...node.content, ...patch }, label);
  },
  setNodeStyle(id: string, patch: Partial<NodeStyle>, coalesceKey?: string): void {
    const current = doc();
    if (!current?.nodes[id]) return;
    run(
      { kind: 'updateNode', id, patch: { style: patch } },
      'Change style',
      { coalesceKey: coalesceKey ?? `style:${id}` },
    );
  },
  /** Corner-drag resizing: one undo step, persisted as explicit width/height. */
  resizeNode(id: string, width: number, height: number, position?: Point): void {
    const current = doc();
    if (!current?.nodes[id]) return;
    run(
      {
        kind: 'updateNode',
        id,
        patch: {
          style: { width: Math.round(width), height: Math.round(height) },
          ...(position ? { position, positionMode: 'manual' as const } : {}),
        },
      },
      'Resize node',
    );
  },
  setResizePreview(preview: ResizePreview | null): void {
    store.dispatch({ type: 'RESIZE_PREVIEW', preview });
  },
  setConflict(conflict: UIState['conflict']): void {
    store.dispatch({ type: 'SET_CONFLICT', conflict });
  },
  toggleCollapse(id: string): void {
    run({ kind: 'toggleCollapse', id }, 'Collapse / expand branch');
  },
  setAllCollapsed(collapsed: boolean): void {
    run({ kind: 'setAllCollapsed', collapsed }, collapsed ? 'Collapse all' : 'Expand all');
  },
  reparent(id: string, parentId: string): void {
    run({ kind: 'reparent', id, parentId }, 'Move branch');
  },
  setTitle(title: string): void {
    run({ kind: 'setTitle', title }, 'Rename map', { coalesceKey: 'map-title' });
  },
  updateSettings(patch: Partial<MindMapDocument['settings']>): void {
    run({ kind: 'updateSettings', patch }, 'Update map settings');
  },
  /* ---------- layout & viewport ---------- */
  /**
   * "Re-arrange" re-places *every* node, including ones dragged by hand. Keeping
   * manual nodes pinned made the command look broken: after a few drags the map
   * could no longer be tidied at all.
   */
  applyLayout(layout?: LayoutKind): void {
    const current = doc();
    if (!current) return;
    const target = layout ?? current.settings.layout;
    const sizes = measureAll(Object.values(current.nodes), current.settings.showDescriptions, current.rootId);
    const total = Object.keys(current.nodes).length;
    run({ kind: 'applyLayout', sizes, layout: target, forceAll: true }, `Apply ${target} layout`);
    actions.toast(`Re-arranged ${total} node${total === 1 ? '' : 's'}`, 'success');
  },
  /** Switching the document layout is explicit intent, so every node is re-placed. */
  changeLayout(layout: LayoutKind): void {
    const current = doc();
    if (!current) return;
    const sizes = measureAll(Object.values(current.nodes), current.settings.showDescriptions, current.rootId);
    run({ kind: 'applyLayout', sizes, layout, forceAll: true }, `Switch to ${layout} layout`);
  },
  resetToAutoLayout(): void {
    const current = doc();
    if (!current) return;
    const sizes = measureAll(Object.values(current.nodes), current.settings.showDescriptions, current.rootId);
    run({ kind: 'resetToAutoLayout', sizes, layout: current.settings.layout }, 'Reset to automatic layout');
    actions.toast('All nodes returned to automatic layout', 'success');
  },
  setAutoArrange(value: boolean): void {
    run(
      { kind: 'updateSettings', patch: { autoArrange: value } },
      value ? 'Enable continuous arrangement' : 'Disable continuous arrangement',
    );
  },
  alignNodes(ids: string[], align: AlignMode): void {
    if (ids.length < 2) return;
    run({ kind: 'alignNodes', ids, align }, `Align ${align}`);
  },
  distributeNodes(ids: string[], axis: 'x' | 'y'): void {
    if (ids.length < 3) return;
    run({ kind: 'distributeNodes', ids, axis }, `Distribute ${axis === 'x' ? 'horizontally' : 'vertically'}`);
  },
  groupNodes(ids: string[], title: string): void {
    if (ids.length < 2) return;
    run({ kind: 'groupNodes', ids, title }, 'Group nodes', { selectCreated: true });
  },
  setPresentationOrder(order: string[]): void {
    run({ kind: 'setPresentationOrder', order }, 'Set presentation order');
  },
  fit(): void {
    store.dispatch({ type: 'FIT_VIEW' });
  },
  center(): void {
    store.dispatch({ type: 'CENTER_VIEW' });
  },
  resetView(): void {
    store.dispatch({ type: 'RESET_VIEW' });
  },
  zoomIn(): void {
    store.dispatch({ type: 'SET_ZOOM', zoom: store.getState().viewport.zoom * 1.2 });
  },
  zoomOut(): void {
    store.dispatch({ type: 'SET_ZOOM', zoom: store.getState().viewport.zoom / 1.2 });
  },
  setZoom(zoom: number): void {
    store.dispatch({ type: 'SET_ZOOM', zoom });
  },
  zoomAt(factor: number, screen: Point): void {
    store.dispatch({ type: 'ZOOM_AT', factor, screen });
  },
  panBy(dx: number, dy: number): void {
    store.dispatch({ type: 'PAN_BY', dx, dy });
  },
  setViewport(x: number, y: number, zoom: number): void {
    store.dispatch({ type: 'SET_VIEWPORT', viewport: { x, y, zoom, animated: false } });
  },

  /* ---------- selection, navigation ---------- */
  select(ids: string[], options: { focus?: boolean } = {}): void {
    store.dispatch({ type: 'SELECT', ids, primaryId: ids[0] ?? null, focus: options.focus });
  },
  clearSelection(): void {
    store.dispatch({ type: 'SELECT', ids: [], primaryId: null });
  },
  /** Clicking a node on the canvas always brings its properties into view. */
  revealNode(id: string): void {
    actions.select([id]);
    store.dispatch({ type: 'SET_UI', patch: { sidebarOpen: true, sidebarTab: 'inspector' } });
  },
  /** Explicit entry point for notes, links, images, checklists, code and formulas. */
  openRichContent(id?: string): void {
    if (id) actions.select([id]);
    store.dispatch({ type: 'OPEN_RICH_CONTENT' });
  },
  selectEdge(id: string | null): void {
    store.dispatch({ type: 'SET_UI', patch: { selectedEdgeId: id, contextMenu: { ...store.getState().ui.contextMenu, open: false } } });
  },
  focusNode(id: string, zoom?: number): void {
    store.dispatch({ type: 'FOCUS_NODE', id, zoom });
  },
  /** Arrow-key navigation across the visible hierarchy. */
  navigate(direction: 'up' | 'down' | 'left' | 'right'): void {
    const current = doc();
    const id = selectedId();
    if (!current || !id) {
      if (current) actions.select([current.rootId], { focus: true });
      return;
    }
    const node = current.nodes[id];
    const siblings = node.parentId ? getChildren(current, node.parentId) : [];
    const index = siblings.findIndex((n) => n.id === id);
    let target: string | null = null;
    if (direction === 'left') target = node.parentId;
    else if (direction === 'right') {
      const children = getChildren(current, id);
      if (children.length) {
        if (node.collapsed) actions.toggleCollapse(id);
        target = children[0].id;
      }
    } else target = siblings[index + (direction === 'down' ? 1 : -1)]?.id ?? null;
    if (target && current.nodes[target]) actions.select([target], { focus: true });
  },

  /* ---------- search ---------- */
  setSearch(query: string): void {
    store.dispatch({ type: 'SET_SEARCH', query });
  },
  setSearchFilters(filters: Partial<SearchFilters>): void {
    store.dispatch({ type: 'SET_SEARCH_FILTERS', filters });
  },
  toggleSearchField(field: SearchFilters['fields'][number]): void {
    const { fields } = store.getState().search.filters;
    const next = fields.includes(field) ? fields.filter((value) => value !== field) : [...fields, field];
    if (!next.length) return;
    actions.setSearchFilters({ fields: next });
  },
  searchStep(delta: number): void {
    store.dispatch({ type: 'SEARCH_STEP', delta });
  },
  clearSearch(): void {
    store.dispatch({ type: 'CLEAR_SEARCH' });
  },
  focusSearch(): void {
    store.dispatch({ type: 'SET_UI', patch: { searchOpen: true } });
  },

  /* ---------- focus & presentation ---------- */
  /** Focus Mode dims everything outside one branch without mutating the document. */
  setFocusRoot(id: string | null): void {
    store.dispatch({ type: 'SET_FOCUS_ROOT', id });
  },
  toggleFocusRoot(id: string): void {
    const current = store.getState().ui.focusRootId;
    actions.setFocusRoot(current === id ? null : id);
  },
  startPresentation(order?: string[]): void {
    store.dispatch({ type: 'PRESENTATION_START', order });
  },
  presentationStep(delta: number): void {
    store.dispatch({ type: 'PRESENTATION_STEP', delta });
  },
  endPresentation(): void {
    store.dispatch({ type: 'PRESENTATION_END' });
  },

  /* ---------- error channels ---------- */
  setStorageError(message: string | null): void {
    store.dispatch({ type: 'SET_STORAGE_ERROR', message });
  },
  setImportError(error: UIState['importError']): void {
    store.dispatch({ type: 'SET_IMPORT_ERROR', error });
  },
  /** Queue an action to run once the user resolves an unsaved-changes prompt. */
  requestPending(action: (() => void) | null): void {
    store.dispatch({ type: 'SET_PENDING_ACTION', action });
  },
  setSidebarTab(tab: UIState['sidebarTab']): void {
    store.dispatch({ type: 'SET_UI', patch: { sidebarTab: tab } });
  },

  /* ---------- connections & clipboard ---------- */
  startLink(sourceId: string): void {
    store.dispatch({ type: 'SET_UI', patch: { linkSourceId: sourceId, contextMenu: { ...store.getState().ui.contextMenu, open: false } } });
    actions.toast('Select another node to create a connection · Esc to cancel');
  },
  cancelLink(): void {
    store.dispatch({ type: 'SET_UI', patch: { linkSourceId: null } });
  },
  finishLink(targetId: string): void {
    const source = store.getState().ui.linkSourceId;
    const label = store.getState().ui.linkLabelDraft;
    if (source && source !== targetId) {
      run({ kind: 'addRelation', source, target: targetId, label }, 'Add connection');
      actions.toast('Connection created', 'success');
    }
    store.dispatch({ type: 'SET_UI', patch: { linkSourceId: null, linkLabelDraft: '' } });
  },
  removeEdge(edgeId: string): void {
    run({ kind: 'removeEdge', edgeId }, 'Remove connection');
  },
  setEdgeLabel(edgeId: string, label: string): void {
    run({ kind: 'setEdgeLabel', edgeId, label }, 'Label connection');
  },
  copyNode(id: string): void {
    const current = doc();
    if (!current) return;
    const payload = extractSubtree(current, id);
    if (!payload) return;
    store.dispatch({ type: 'SET_UI', patch: { clipboard: payload } });
    actions.toast('Branch copied to clipboard', 'success');
  },
  paste(parentId?: string, position?: Point): void {
    const state = store.getState();
    const current = state.history.present;
    const payload = state.ui.clipboard;
    if (!current || !payload) {
      actions.toast('Clipboard is empty', 'error');
      return;
    }
    const target = parentId ?? selectedId() ?? current.rootId;
    run({ kind: 'pasteSubtree', parentId: target, payload, position }, 'Paste branch', { selectCreated: true });
  },

  /* ---------- drag transactions ---------- */
  beginDrag(label = 'Move nodes'): void {
    store.dispatch({ type: 'BEGIN_DRAG', label });
  },
  dragMove(positions: Record<string, Point>): void {
    store.dispatch({ type: 'DRAG_MOVE', positions });
  },
  endDrag(): void {
    store.dispatch({ type: 'END_DRAG' });
  },

  /* ---------- UI ---------- */
  setUI(patch: Partial<UIState>): void {
    store.dispatch({ type: 'SET_UI', patch });
  },
  openDialog(dialog: DialogKind): void {
    store.dispatch({ type: 'SET_UI', patch: { dialog, contextMenu: { ...store.getState().ui.contextMenu, open: false } } });
  },
  closeDialog(): void {
    store.dispatch({ type: 'SET_UI', patch: { dialog: null } });
  },
  setEditing(id: string | null): void {
    store.dispatch({ type: 'SET_UI', patch: { editingNodeId: id } });
  },
  setTheme(theme: ThemeKind): void {
    store.dispatch({ type: 'SET_THEME', theme });
  },
  toggleTheme(): void {
    const next = store.getState().ui.theme === 'dark' ? 'light' : 'dark';
    store.dispatch({ type: 'SET_THEME', theme: next });
  },
  toast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
    store.dispatch({ type: 'TOAST', message, tone });
  },
  showContextMenu(x: number, y: number, world: Point, target: 'node' | 'canvas' | 'edge', targetId: string | null): void {
    store.dispatch({
      type: 'SET_UI',
      patch: { contextMenu: { open: true, x, y, world, target, targetId } },
    });
  },
  closeContextMenu(): void {
    const menu = store.getState().ui.contextMenu;
    if (menu.open) store.dispatch({ type: 'SET_UI', patch: { contextMenu: { ...menu, open: false } } });
  },
  toggleOutline(id: string): void {
    store.dispatch({ type: 'TOGGLE_OUTLINE', id });
  },
  isNodeVisible(id: string): boolean {
    const current = doc();
    return current ? isVisible(current, id) : false;
  },
};
