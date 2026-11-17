import { describe, expect, it } from 'vitest';
import { findByTitle, makeDoc } from '../test/fixtures';
import { createInitialState, depthFirstOrder, reducer, type Action } from './store';

function apply(state: ReturnType<typeof createInitialState>, ...actions: Action[]) {
  return actions.reduce<ReturnType<typeof createInitialState>>((current, action) => reducer(current, action), state);
}

function loaded() {
  const doc = makeDoc();
  return { state: reducer(createInitialState(), { type: 'LOAD', doc }), doc };
}

describe('application store', () => {
  it('starts empty with sane defaults', () => {
    const state = createInitialState();
    expect(state.history.present).toBeNull();
    expect(state.ui.sidebarTab).toBe('inspector');
    expect(state.ui.presentation.active).toBe(false);
    expect(state.search.filters.fields).toContain('title');
  });

  it('loads a document, commits commands, and supports undo/redo', () => {
    const { state } = loaded();
    expect(state.history.present?.title).toBe('Test map');
    expect(state.selection.primaryId).toBe(state.history.present?.rootId);
    expect(state.ui.dirty).toBe(false);
    const rootId = state.history.present!.rootId;
    const added = apply(state, { type: 'COMMIT', command: { kind: 'addChild', parentId: rootId }, label: 'Add child', selectCreated: true });
    expect(Object.keys(added.history.present!.nodes)).toHaveLength(Object.keys(state.history.present!.nodes).length + 1);
    expect(added.ui.dirty).toBe(true);
    expect(added.selection.primaryId).not.toBe(rootId);
    const undone = apply(added, { type: 'UNDO' });
    expect(Object.keys(undone.history.present!.nodes)).toHaveLength(Object.keys(state.history.present!.nodes).length);
    expect(apply(undone, { type: 'REDO' }).selection.primaryId).toBe(added.selection.primaryId);
  });

  it('stamps dragged nodes as manual and records one undo step', () => {
    const { state } = loaded();
    const id = findByTitle(state.history.present!, 'Build').id;
    const dragged = apply(
      state,
      { type: 'BEGIN_DRAG', label: 'Move nodes' },
      { type: 'DRAG_MOVE', positions: { [id]: { x: 321, y: 123 } } },
      { type: 'END_DRAG' },
    );
    expect(dragged.history.present!.nodes[id].position).toEqual({ x: 321, y: 123 });
    expect(dragged.history.present!.nodes[id].positionMode).toBe('manual');
    expect(dragged.history.past).toHaveLength(1);
    expect(apply(dragged, { type: 'UNDO' }).history.present!.nodes[id].position).not.toEqual({ x: 321, y: 123 });
  });

  it('runs ranked search and honours filter changes', () => {
    const { state } = loaded();
    const searched = apply(state, { type: 'SET_SEARCH', query: 'Research' });
    expect(searched.search.results.length).toBeGreaterThan(0);
    expect(searched.search.matches[0]).toBe(findByTitle(state.history.present!, 'Research').id);
    const filtered = apply(searched, { type: 'SET_SEARCH_FILTERS', filters: { fields: ['type'] } });
    expect(filtered.search.results).toHaveLength(0);
    expect(filtered.search.filters.fields).toEqual(['type']);
  });

  it('manages focus mode, presentation steps and error channels', () => {
    const { state } = loaded();
    const focusId = findByTitle(state.history.present!, 'Build').id;
    const focused = apply(state, { type: 'SET_FOCUS_ROOT', id: focusId });
    expect(focused.ui.focusRootId).toBe(focusId);
    expect(focused.selection.primaryId).toBe(focusId);
    const started = apply(focused, { type: 'PRESENTATION_START' });
    expect(started.ui.presentation.active).toBe(true);
    expect(started.ui.presentation.order).toEqual(depthFirstOrder(started.history.present!));
    expect(started.ui.presentation.order.length).toBeGreaterThan(1);
    const stepped = apply(started, { type: 'PRESENTATION_STEP', delta: 1 });
    expect(stepped.ui.presentation.index).toBe(1);
    expect(apply(stepped, { type: 'PRESENTATION_END' }).ui.presentation.active).toBe(false);
    const errored = apply(state, { type: 'SET_STORAGE_ERROR', message: 'quota' });
    expect(errored.ui.storageError).toBe('quota');
    expect(apply(errored, { type: 'MARK_SAVED', at: 1 }).ui.storageError).toBeNull();
  });

  it('keeps drag frames out of history and commits exactly once', () => {
    const { state } = loaded();
    const id = findByTitle(state.history.present!, 'Build').id;
    const moving = apply(
      state,
      { type: 'BEGIN_DRAG', label: 'Move nodes' },
      { type: 'DRAG_MOVE', positions: { [id]: { x: 9, y: 9 } } },
      { type: 'DRAG_MOVE', positions: { [id]: { x: 20, y: 20 } } },
    );
    // The document object must stay identical so the derived context does not
    // recompute on every pointermove frame.
    expect(moving.history.present).toBe(state.history.present);
    expect(moving.history.past).toHaveLength(0);
    expect(moving.dragPositions?.[id]).toEqual({ x: 20, y: 20 });
    const done = apply(moving, { type: 'END_DRAG' });
    expect(done.history.present!.nodes[id].position).toEqual({ x: 20, y: 20 });
    expect(done.history.present!.nodes[id].positionMode).toBe('manual');
    expect(done.history.past).toHaveLength(1);
    expect(done.dragPositions).toBeNull();
    expect(done.transaction).toBeNull();
  });

  it('resets transient state when a new document is loaded', () => {
    const { state } = loaded();
    const messy = apply(state,
      { type: 'SET_FOCUS_ROOT', id: state.history.present!.rootId },
      { type: 'PRESENTATION_START' },
      { type: 'SET_IMPORT_ERROR', error: { message: 'x', details: [], filename: 'x' } },
    );
    const clean = reducer(messy, { type: 'LOAD', doc: makeDoc('Next') });
    expect(clean.ui.focusRootId).toBeNull();
    expect(clean.ui.presentation.active).toBe(false);
    expect(clean.ui.importError).toBeNull();
    expect(clean.history.past).toHaveLength(0);
  });

  it('keeps a resize preview transient and clears it on load', () => {
    const { state } = loaded();
    const id = state.history.present!.rootId;
    const preview = { id, width: 320, height: 180, position: { x: 10, y: 20 } };
    const resizing = reducer(state, { type: 'RESIZE_PREVIEW', preview });
    expect(resizing.resizePreview).toEqual(preview);
    expect(resizing.history.present).toBe(state.history.present);
    expect(resizing.ui.dirty).toBe(false);
    expect(reducer(resizing, { type: 'RESIZE_PREVIEW', preview: null }).resizePreview).toBeNull();
    expect(reducer(resizing, { type: 'LOAD', doc: makeDoc('Next') }).resizePreview).toBeNull();
  });

  it('tracks a cross-tab conflict and clears it on load', () => {
    const { state } = loaded();
    const conflict = { mapId: state.history.present!.id, remoteRevision: 42, title: 'Test map', dirty: true, at: Date.now() };
    const blocked = reducer(state, { type: 'SET_CONFLICT', conflict });
    expect(blocked.ui.conflict).toEqual(conflict);
    expect(reducer(blocked, { type: 'LOAD', doc: makeDoc('Next') }).ui.conflict).toBeNull();
    expect(reducer(blocked, { type: 'SET_CONFLICT', conflict: null }).ui.conflict).toBeNull();
  });

  it('opening rich content reveals the inspector and increments the focus token', () => {
    const { state } = loaded();
    const hidden = apply(state, { type: 'SET_UI', patch: { sidebarOpen: false, sidebarTab: 'outline' } });
    const opened = reducer(hidden, { type: 'OPEN_RICH_CONTENT' });
    expect(opened.ui.sidebarOpen).toBe(true);
    expect(opened.ui.sidebarTab).toBe('inspector');
    expect(opened.ui.contentFocus).toBe(hidden.ui.contentFocus + 1);
  });
});

describe('re-arrange', () => {
  it('moves manually placed nodes back into the layout', () => {
    const { state, doc } = loaded();
    const child = findByTitle(doc, 'Research');
    const pinned = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [child.id]: { ...doc.nodes[child.id], position: { x: 9000, y: 9000 }, positionMode: 'manual' as const },
      },
    };
    const withPin = reducer(state, { type: 'LOAD', doc: pinned });
    const sizes = Object.fromEntries(
      Object.keys(pinned.nodes).map((id) => [id, {
        width: 160, height: 44, lines: [''], descriptionLine: '', lineHeight: 20, icon: '',
        fontSize: 14, fontFamily: 'Inter', fontWeight: 560, letterSpacing: 0,
        textAnchor: 'start' as const, radius: 10, badges: [], image: undefined, imageCount: 0,
      }]),
    );
    const next = reducer(withPin, {
      type: 'COMMIT',
      command: { kind: 'applyLayout', sizes, layout: 'horizontal', forceAll: true },
      label: 'Re-arrange',
    });
    const moved = next.history.present!.nodes[child.id];
    expect(moved.position).not.toEqual({ x: 9000, y: 9000 });
    expect(moved.positionMode).toBe('auto');
  });
});
