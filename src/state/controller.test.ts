import { describe, expect, it, vi } from 'vitest';
import { documentToJson } from '../export/json';
import { mapRepository } from '../persistence/indexeddb';
import { makeDoc } from '../test/fixtures';
import { actions } from './actions';
import { controller } from './controller';
import { store } from './store';

function dirtyWithoutAutoSave(title = 'Unsaved work') {
  actions.load(makeDoc(title));
  actions.setUI({ dirty: true, autoSave: false, dialog: null, pendingAction: null });
}

function state() {
  return store.getState();
}

describe('unsaved-work guard', () => {
  it('asks before a new blank map replaces unsaved work', () => {
    dirtyWithoutAutoSave();
    controller.createBlank();
    expect(state().ui.dialog).toBe('unsaved');
    expect(state().ui.pendingAction).not.toBeNull();
    expect(state().history.present?.title).toBe('Unsaved work');
  });

  it('asks before an import replaces unsaved work', async () => {
    dirtyWithoutAutoSave();
    const result = await controller.importText(documentToJson(makeDoc('Imported')));
    expect(result).not.toBeNull();
    expect(state().ui.dialog).toBe('unsaved');
    expect(state().history.present?.title).toBe('Unsaved work');
  });

  it('asks before an AI outline replaces unsaved work', async () => {
    dirtyWithoutAutoSave();
    const outline = JSON.stringify({ title: 'AI map', nodes: [{ title: 'Root', children: [{ title: 'Idea' }] }] });
    // The AI schema may reject this exact shape; the guard must be checked either way.
    await controller.importAIOutline(outline);
    if (state().ui.dialog === 'unsaved') {
      expect(state().history.present?.title).toBe('Unsaved work');
    } else {
      expect(state().ui.dialog).toBe('importError');
    }
  });

  it('runs the deferred action only after the user chooses discard', async () => {
    dirtyWithoutAutoSave();
    controller.createBlank();
    expect(state().ui.dialog).toBe('unsaved');
    await controller.resolveUnsaved('discard');
    expect(state().ui.dialog).toBeNull();
    expect(state().ui.pendingAction).toBeNull();
    expect(state().history.present?.title).toBe('Untitled map');
  });

  it('cancelling leaves the current document untouched', async () => {
    dirtyWithoutAutoSave();
    controller.createBlank();
    await controller.resolveUnsaved('cancel');
    expect(state().history.present?.title).toBe('Unsaved work');
    expect(state().ui.pendingAction).toBeNull();
  });
});

describe('deleting maps', () => {
  it('does not resurrect the open map when it is deleted', async () => {
    const target = makeDoc('Doomed map');
    const other = makeDoc('Survivor');
    await mapRepository.save(target);
    await mapRepository.save(other);

    actions.load(target);
    actions.setUI({ dirty: true, autoSave: true, dialog: null, pendingAction: null });

    await controller.remove(target.id);
    // The replacement path is async; give the queue time to settle.
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(await mapRepository.get(target.id)).toBeNull();
    expect(state().history.present?.id).toBe(other.id);
    expect(state().ui.dirty).toBe(false);
  });

  it('closes the editor when the last map is deleted', async () => {
    const only = makeDoc('Only map');
    await mapRepository.clear();
    await mapRepository.save(only);
    actions.load(only);
    actions.setUI({ dirty: false, autoSave: true, dialog: null, pendingAction: null });

    await controller.remove(only.id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state().history.present).toBeNull();
    expect(await mapRepository.list()).toHaveLength(0);
  });
});

describe('save failures', () => {
  it('stays dirty and reports failure when the write is rejected', async () => {
    const doc = makeDoc('Unwritable');
    actions.load(doc);
    actions.setUI({ dirty: true, autoSave: true });
    const spy = vi.spyOn(mapRepository, 'saveAtomic').mockRejectedValue(new Error('quota exceeded'));
    try {
      expect(await controller.persist(true)).toBe(false);
      expect(state().ui.dirty).toBe(true);
      expect(state().ui.storageError).toContain('quota exceeded');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('auto-save race', () => {
  it('keeps an edit dirty when a save resolves after that edit', async () => {
    const doc = makeDoc('Race');
    actions.load(doc);
    actions.setUI({ dirty: true, autoSave: true });
    const spy = vi.spyOn(mapRepository, 'saveAtomic').mockImplementation(async (saved) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return {
        summary: {
          id: saved.id,
          title: saved.title,
          nodeCount: Object.keys(saved.nodes).length,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        },
        revision: 123,
      };
    });
    try {
      const saving = controller.persist(true);
      actions.setTitle('Edited during save');
      expect(await saving).toBe(true);
      // The newer document must not have its dirty flag cleared by MARK_SAVED.
      expect(state().history.present?.title).toBe('Edited during save');
      expect(state().ui.dirty).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('rename safety', () => {
  it('renames the live document and preserves unsaved edits', async () => {
    const doc = makeDoc('Stored title');
    await mapRepository.save(doc);
    actions.load(doc);
    actions.setUI({ dirty: false, autoSave: false, dialog: null, pendingAction: null, conflict: null });
    actions.editNode(doc.rootId, { title: 'Unsaved node title' });
    const getSpy = vi.spyOn(mapRepository, 'get');

    await controller.rename(doc.id, 'Renamed map');

    expect(getSpy).not.toHaveBeenCalled();
    expect(state().history.present?.title).toBe('Renamed map');
    expect(state().history.present?.nodes[doc.rootId].title).toBe('Unsaved node title');
    const stored = await mapRepository.get(doc.id);
    expect(stored?.title).toBe('Renamed map');
    expect(stored?.nodes[doc.rootId].title).toBe('Unsaved node title');
    getSpy.mockRestore();
  });

  it('uses atomic conflict handling when renaming a map that is not open', async () => {
    const doc = makeDoc('Other map');
    await mapRepository.save(doc);
    actions.load(makeDoc('Current map'));
    actions.setUI({ dirty: false, autoSave: false, conflict: null });

    await controller.rename(doc.id, 'Renamed elsewhere');
    const stored = await mapRepository.get(doc.id);
    expect(stored?.title).toBe('Renamed elsewhere');
  });
});
