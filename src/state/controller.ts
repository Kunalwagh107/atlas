import { layoutDocument } from '../core/layout';
import { measureAll } from '../core/layout/measure';
import { createBlankDocument, getStats } from '../core/mindmap/operations';
import { buildTemplateDocument } from '../core/mindmap/templates';
import type { MindMapDocument } from '../core/mindmap/types';
import {
  ImportError,
  buildDiagnosticReport,
  getLastImportDiagnostics,
  parseDocument,
  parseDocumentFromText,
} from '../core/mindmap/validation';
import {
  mapRepository,
  queueStorageWrite,
  readLocalSettings,
  RevisionConflictError,
  writeLocalSettings,
} from '../persistence/indexeddb';
import { isLocalImageRef } from '../core/mindmap/content';
import {
  copyImageBlobs,
  deleteImageBlobs,
  hydrateDocumentImages,
  prepareDocumentForStorage,
} from '../persistence/imageBlobs';
import { pruneOrphanImageBlobs, scheduleImageGc, type ProtectedImageRef } from '../persistence/imageGc';
import { publishSave, readRevision, subscribeToSaves, type SaveSignal } from '../persistence/sync';
import { versionRepository, type VersionSummary } from '../persistence/versions';
import { detectFormat, parseForeignDocument } from '../core/mindmap/codecs';
import { AIValidationError, parseAIDocument } from '../core/mindmap/ai';
import { BackupError, parseBackup, serializeBackup } from '../export/backup';
import { isPortableMapText, parsePortableMap, PortableMapError } from '../export/portable';
import { downloadBlob, uid } from '../utils/common';
import { actions } from './actions';
import { store } from './store';

function applyInitialLayout(doc: MindMapDocument): MindMapDocument {
  const nodes = Object.values(doc.nodes);
  const meaningful = nodes.filter((node) => node.position.x !== 0 || node.position.y !== 0);
  if (nodes.length > 1 && meaningful.length <= 1) {
    const sizes = measureAll(nodes, doc.settings.showDescriptions, doc.rootId);
    return layoutDocument(doc, sizes, doc.settings.layout);
  }
  return doc;
}

function currentDoc(): MindMapDocument | null {
  return store.getState().history.present;
}

/** New documents are not in storage yet — flag them so auto-save writes them immediately. */
function markUnsaved(): void {
  actions.setUI({ dirty: true, savedAt: null });
}

/** The History tab/dialog refresh themselves when a snapshot changes. */
function notifyVersionsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('atlas:versions-changed'));
}

/** Every image still reachable through Undo/Redo, plus the live document. */
function historyImageRefs(): ProtectedImageRef[] {
  const { history } = store.getState();
  const docs = [
    ...history.past.map((entry) => entry.snapshot),
    history.present,
    ...history.future.map((entry) => entry.snapshot),
  ].filter((doc): doc is MindMapDocument => !!doc);
  return docs.flatMap((doc) => Object.values(doc.nodes).flatMap((node) =>
    (node.content?.images ?? [])
      .filter((image) => isLocalImageRef(image.src))
      .map((image) => ({ mapId: doc.id, imageId: image.id })),
  ));
}

function describeStorageFailure(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'Browser storage is full — export this map to keep it safe.';
    if (error.name === 'SecurityError') return 'Browser storage is blocked for this page.';
  }
  return error instanceof Error ? error.message : 'Browser storage is unavailable';
}

/* ---------- central auto-save ------------------------------------------------
 * The debounce lives here (not in a React hook) so every document replacement
 * can cancel or flush it. Otherwise a queued write for the OLD document lands
 * after the new one is loaded, and pending edits die in the 900 ms window.
 */
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelAutoSave(): void {
  if (autoSaveTimer !== null) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

export function scheduleAutoSave(): void {
  const state = store.getState();
  // A conflict blocks writes until the user resolves it, so retrying is pointless.
  if (!state.ui.autoSave || !state.ui.dirty || !state.history.present || state.transaction || state.ui.conflict) {
    cancelAutoSave();
    return;
  }
  cancelAutoSave();
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void controller.persist(true);
  }, 900);
}

/** Write any pending changes now, before a document replacement. */
export async function flushAutoSave(): Promise<boolean> {
  cancelAutoSave();
  if (!store.getState().ui.dirty) return true;
  return controller.persist(true);
}

/**
 * The only way to put a different document on screen. Cancels the pending save
 * first so a stale write cannot overwrite the freshly loaded map.
 */
function replaceDocument(doc: MindMapDocument, options: { fit?: boolean; markClean?: boolean } = {}): void {
  cancelAutoSave();
  trackDocument(doc);
  actions.load(doc, options.fit ?? true, options.markClean ?? true);
}

/** True when the document changed while an async read was in flight. */
function stale(snapshot: MindMapDocument | null): boolean {
  return currentDoc() !== snapshot;
}

/* ---------- cross-tab conflict tracking -------------------------------------
 * `seenRevision` is the newest revision this tab has either written itself or
 * accepted from another tab. A save is refused when the browser knows about a
 * newer revision — that is what turns last-write-wins into a warning.
 */
let openMapId: string | null = null;
let seenRevision = 0;
let syncStarted = false;
let reloading = false;
let resolvingConflict = false;

function trackDocument(doc: MindMapDocument): void {
  openMapId = doc.id;
  seenRevision = readRevision(doc.id);
  if (store.getState().ui.conflict) actions.setConflict(null);
}

function conflictFor(doc: MindMapDocument, remoteRevision: number, dirty: boolean) {
  return {
    mapId: doc.id,
    remoteRevision,
    title: doc.title,
    dirty,
    at: Date.now(),
  };
}

/** Keep a named snapshot of the local work before it is replaced or overwritten. */
async function keepRecoverySnapshot(doc: MindMapDocument, label: string): Promise<void> {
  try {
    await versionRepository.save(doc, { kind: 'named', label, force: true });
    notifyVersionsChanged();
  } catch {
    /* a failed snapshot must not block conflict resolution */
  }
}

/** Adopt the other tab's version when this tab has nothing unsaved. */
async function reloadFromDisk(signal: SaveSignal): Promise<void> {
  if (reloading) return;
  reloading = true;
  const before = currentDoc();
  try {
    const next = await mapRepository.get(signal.mapId);
    if (!next || stale(before)) return;
    replaceDocument(next, { fit: false });
    actions.toast('This map was updated in another tab — reloaded', 'info');
  } catch {
    actions.toast('Could not reload the version saved in the other tab', 'error');
  } finally {
    reloading = false;
  }
}

function handleRemoteSave(signal: SaveSignal): void {
  if (!openMapId || signal.mapId !== openMapId) return;
  const doc = currentDoc();
  if (!doc) return;
  if (signal.revision <= seenRevision) return;
  const { ui } = store.getState();
  if (ui.conflict) {
    if (signal.revision > ui.conflict.remoteRevision) {
      actions.setConflict({ ...ui.conflict, remoteRevision: signal.revision, title: signal.title || ui.conflict.title, at: Date.now() });
    }
    return;
  }
  if (!ui.dirty) {
    // Nothing of ours can be lost; a dialog or presentation is mid-task though.
    if (ui.dialog || ui.presentation.active) {
      actions.setConflict(conflictFor(doc, signal.revision, false));
      return;
    }
    void reloadFromDisk(signal);
    return;
  }
  actions.setConflict(conflictFor(doc, signal.revision, true));
  void keepRecoverySnapshot(doc, 'Before tab conflict');
  actions.toast('Another tab saved this map — your edits are safe. Choose how to continue.', 'info');
}

/**
 * Anything that replaces the current map checks for unsaved work first — including
 * imports and AI outlines. With auto-save ON we flush the pending
 * write instead of prompting; if that write fails we still ask rather than discard.
 */
function guardUnsaved(proceed: () => void): void {
  const { ui, history } = store.getState();
  if (!history.present || !ui.dirty) {
    proceed();
    return;
  }
  if (ui.autoSave) {
    void flushAutoSave().then((saved) => {
      if (saved) proceed();
      else {
        actions.requestPending(proceed);
        actions.openDialog('unsaved');
      }
    });
    return;
  }
  actions.requestPending(proceed);
  actions.openDialog('unsaved');
}

/** Unguarded read-and-display. Never call this without clearing the dirty flag first. */
async function loadMap(id: string): Promise<boolean> {
  const before = currentDoc();
  try {
    const doc = await mapRepository.get(id);
    if (stale(before)) return false;
    if (!doc) {
      actions.toast('This map could not be found', 'error');
      return false;
    }
    replaceDocument(applyInitialLayout(doc));
    writeLocalSettings({ ...readLocalSettings(), lastMapId: doc.id });
    actions.closeDialog();
    actions.toast(`Opened “${doc.title}”`, 'success');
    return true;
  } catch (error) {
    actions.setStorageError(describeStorageFailure(error));
    actions.toast('Could not open this map', 'error');
    return false;
  }
}

/** Implementation of conflict resolution; `controller.resolveConflict` guards re-entry. */
async function resolveConflictNow(choice: 'copy' | 'reload' | 'overwrite'): Promise<void> {
  const state = store.getState();
  const conflict = state.ui.conflict;
  const doc = state.history.present;
  if (!conflict || !doc || doc.id !== conflict.mapId) {
    actions.setConflict(null);
    return;
  }

  if (choice === 'copy') {
    const now = Date.now();
    const copy: MindMapDocument = {
      ...doc,
      id: uid('map'),
      title: `${doc.title} (conflict copy)`,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await copyImageBlobs(doc.id, copy.id);
      const saved = await queueStorageWrite(() => mapRepository.saveAtomic(copy, readRevision(copy.id)));
      seenRevision = saved.revision;
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not save a conflict copy — export the map to keep it', 'error');
      return;
    }
    await keepRecoverySnapshot(doc, 'Before tab conflict');
    const revision = seenRevision;
    publishSave(copy.id, revision, copy.title);
    replaceDocument(copy, { fit: false });
    actions.markSaved();
    writeLocalSettings({ ...readLocalSettings(), lastMapId: copy.id });
    actions.toast(`Your edits were saved as “${copy.title}”`, 'success');
    return;
  }

  if (choice === 'reload') {
    if (state.ui.dirty) await keepRecoverySnapshot(doc, 'Before tab conflict');
    actions.setConflict(null);
    seenRevision = conflict.remoteRevision;
    const loaded = await loadMap(conflict.mapId);
    actions.toast(loaded ? 'Loaded the version saved in the other tab' : 'Could not load the other version', loaded ? 'success' : 'error');
    return;
  }

  // Explicit overwrite: keep the other tab's bytes as a recoverable snapshot.
  try {
    const remote = await mapRepository.get(conflict.mapId);
    if (remote) await keepRecoverySnapshot(remote, 'Replaced from another tab');
  } catch {
    /* best effort */
  }
  actions.setConflict(null);
  seenRevision = conflict.remoteRevision;
  const saved = await controller.persist(true, { force: true });
  actions.toast(
    saved ? 'Saved this tab’s version — the other tab was snapshotted' : 'Could not save this tab’s version',
    saved ? 'success' : 'error',
  );
}

export const controller = {
  async bootstrap(): Promise<void> {
    const before = currentDoc();
    const settings = readLocalSettings();
    try {
      let doc = settings.lastMapId ? await mapRepository.get(settings.lastMapId) : null;
      if (!doc) {
        const [recent] = await mapRepository.list();
        if (recent) doc = await mapRepository.get(recent.id);
      }
      // The user may have created or edited a map while IndexedDB was being read.
      if (stale(before)) return;
      if (doc) {
        replaceDocument(applyInitialLayout(doc));
        scheduleImageGc(historyImageRefs);
        return;
      }
    } catch (error) {
      const message = describeStorageFailure(error);
      actions.setStorageError(message);
      actions.toast(`Could not read saved maps — ${message}`, 'error');
    }
    // No map: the polished empty state is shown by the shell.
  },

  createBlank(): void {
    guardUnsaved(() => {
      replaceDocument(createBlankDocument('Untitled map'));
      markUnsaved();
      actions.toast('Blank map created', 'success');
    });
  },

  createFromTemplate(templateId: string): void {
    guardUnsaved(() => {
      const raw = buildTemplateDocument(templateId);
      const doc = applyInitialLayout(raw);
      replaceDocument(doc);
      markUnsaved();
      actions.toast(`${doc.title} template created`, 'success');
    });
  },

  /** Single write path used by both the explicit Save command and auto-save. */
  async persist(quiet = false, options: { force?: boolean } = {}): Promise<boolean> {
    const doc = currentDoc();
    if (!doc) return false;
    cancelAutoSave();
    // Refuse to overwrite a newer revision written by another tab.
    if (!options.force) {
      const remote = readRevision(doc.id);
      if (remote > seenRevision) {
        const dirty = store.getState().ui.dirty;
        actions.setConflict(conflictFor(doc, remote, dirty));
        if (dirty) void keepRecoverySnapshot(doc, 'Before tab conflict');
        if (!quiet) {
          actions.toast('This map changed in another tab — resolve the conflict to save', 'error');
        }
        return false;
      }
    }
    try {
      // The revision check and the write are one IndexedDB transaction, so a
      // concurrent tab cannot pass the same stale check before we publish.
      const { revision } = await queueStorageWrite(() => mapRepository.saveAtomic(doc, seenRevision));
      // An edit dispatched during the await must keep its dirty flag; otherwise it
      // would never be written and the leave-site guard would not warn either.
      if (currentDoc() === doc) actions.markSaved();
      seenRevision = revision;
      openMapId = doc.id;
      publishSave(doc.id, revision, doc.title);
      actions.setConflict(null);
      writeLocalSettings({ ...readLocalSettings(), lastMapId: doc.id });
      if (!quiet) actions.toast('Map saved', 'success');
      // Snapshots are best-effort: a version-store failure must never break saving.
      void versionRepository.save(doc, { kind: 'auto' })
        .then((snapshot) => { if (snapshot) notifyVersionsChanged(); })
        .catch(() => null);
      scheduleImageGc(historyImageRefs);
      return true;
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        const dirty = store.getState().ui.dirty;
        actions.setConflict(conflictFor(doc, error.actual, dirty));
        if (dirty) void keepRecoverySnapshot(doc, 'Before tab conflict');
        if (!quiet) actions.toast('This map changed in another tab — resolve the conflict to save', 'error');
        return false;
      }
      const message = describeStorageFailure(error);
      actions.setStorageError(message);
      actions.toast(`Save failed — ${message}`, 'error');
      return false;
    }
  },

  save(): Promise<boolean> {
    return controller.persist(false);
  },

  /** Start listening for saves made by other tabs (called once on boot). */
  initTabSync(): void {
    if (syncStarted) return;
    syncStarted = true;
    subscribeToSaves(handleRemoteSave);
    const doc = currentDoc();
    if (doc) {
      openMapId = doc.id;
      seenRevision = readRevision(doc.id);
    }
  },

  /**
   * Resolve a cross-tab conflict. Every destructive branch keeps a named
   * snapshot first, so neither tab's work can disappear silently.
   */
  async resolveConflict(choice: 'copy' | 'reload' | 'overwrite'): Promise<void> {
    // A double click must not create two copies or two overwrite writes.
    if (resolvingConflict) return;
    resolvingConflict = true;
    try {
      await resolveConflictNow(choice);
    } finally {
      resolvingConflict = false;
    }
  },

  async saveAs(title: string): Promise<void> {
    const doc = currentDoc();
    if (!doc) return;
    const now = Date.now();
    const copy: MindMapDocument = {
      ...doc,
      id: uid('map'),
      title: title.trim() || doc.title,
      createdAt: now,
      updatedAt: now,
    };
    // Stay dirty until the copy is actually written, so a failed save stays visible.
    replaceDocument(copy, { fit: false, markClean: false });
    try {
      await copyImageBlobs(doc.id, copy.id);
      const saved = await queueStorageWrite(() => mapRepository.saveAtomic(copy, readRevision(copy.id)));
      if (currentDoc() === copy) actions.markSaved();
      seenRevision = saved.revision;
      publishSave(copy.id, saved.revision, copy.title);
      writeLocalSettings({ ...readLocalSettings(), lastMapId: copy.id });
      actions.closeDialog();
      actions.toast(`Saved as “${copy.title}”`, 'success');
    } catch (error) {
      const message = describeStorageFailure(error);
      actions.setStorageError(message);
      actions.toast(`Save failed — ${message}`, 'error');
    }
  },

  /** Remove image blobs not referenced by any map, version snapshot or undo step. */
  async cleanUnusedImages(): Promise<void> {
    try {
      const result = await pruneOrphanImageBlobs(historyImageRefs());
      actions.toast(
        result.deleted
          ? `Removed ${result.deleted} unused image${result.deleted === 1 ? '' : 's'}`
          : 'No unused images to remove',
        'success',
      );
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not clean up unused images', 'error');
    }
  },

  /** Download every saved map as one JSON file (moves the library between devices). */
  async backupAll(): Promise<void> {
    try {
      const summaries = await mapRepository.list();
      const docs: MindMapDocument[] = [];
      for (const summary of summaries) {
        const doc = await mapRepository.get(summary.id);
        if (doc) {
          // Embed local image bytes so the file is portable and always restorable.
          docs.push((await hydrateDocumentImages(doc)).doc);
        }
      }
      if (!docs.length) {
        actions.toast('There are no saved maps to back up', 'error');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(
        new Blob([serializeBackup(docs)], { type: 'application/json;charset=utf-8' }),
        `atlas-backup-${stamp}.json`,
      );
      actions.toast(`Backed up ${docs.length} map${docs.length === 1 ? '' : 's'}`, 'success');
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not create the backup', 'error');
    }
  },

  /**
   * Restore maps from a backup file. Every map becomes a copy with a new id, so
   * a restore can never overwrite work that is already in this browser.
   */
  async restoreBackup(file: File): Promise<void> {
    let docs: MindMapDocument[];
    try {
      docs = parseBackup(await file.text());
    } catch (error) {
      const message = error instanceof BackupError ? error.message : 'This backup could not be read';
      const details = error instanceof BackupError ? error.details : [];
      actions.setImportError({ message, details, filename: file.name });
      actions.openDialog('importError');
      actions.toast(message, 'error');
      return;
    }
    try {
      const existingTitles = new Set((await mapRepository.list()).map((summary) => summary.title));
      let first: MindMapDocument | null = null;
      for (const doc of docs) {
        const now = Date.now();
        const title = existingTitles.has(doc.title) ? `${doc.title} (restored)` : doc.title;
        const copy: MindMapDocument = { ...doc, id: uid('map'), title, createdAt: now, updatedAt: now };
        // Embedded image bytes become local blobs before the document is saved.
        const stored = await prepareDocumentForStorage(copy);
        const saved = await queueStorageWrite(() => mapRepository.saveAtomic(stored, readRevision(stored.id)));
        publishSave(stored.id, saved.revision, stored.title);
        existingTitles.add(title);
        if (!first) first = stored;
      }
      const restored = docs.length;
      const issues = (docs as MindMapDocument[] & { issues?: string[] }).issues ?? [];
      if (issues.length) {
        actions.setImportError({
          message: `Restored ${restored} map${restored === 1 ? '' : 's'}; ${issues.length} entr${issues.length === 1 ? 'y was' : 'ies were'} skipped`,
          details: issues,
          filename: file.name,
        });
        actions.openDialog('importError');
      }
      actions.toast(`Restored ${restored} map${restored === 1 ? '' : 's'} as copies`, 'success');
      if (first) {
        const target: MindMapDocument = first;
        guardUnsaved(() => {
          replaceDocument(target);
          writeLocalSettings({ ...readLocalSettings(), lastMapId: target.id });
        });
      }
    } catch (error) {
      const message = describeStorageFailure(error);
      const details = error instanceof BackupError ? error.details : [];
      actions.setStorageError(message);
      actions.setImportError({ message, details, filename: file.name });
      actions.openDialog('importError');
      actions.toast('Could not restore this backup', 'error');
    }
  },

  /**
   * Read and display a stored map. Callers that are replacing unsaved work must
   * go through `guardUnsaved` first; `remove()` deliberately does not, because
   * the map being replaced has just been deleted on purpose.
   */
  async open(id: string): Promise<void> {
    guardUnsaved(() => {
      void loadMap(id);
    });
  },

  async rename(id: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    const current = currentDoc();
    if (current?.id === id) {
      // Rename the live document, then save that exact object. Reading from
      // storage here would overwrite unsaved edits with an older revision.
      if (current.title === clean) return;
      actions.setTitle(clean);
      if (await controller.save()) actions.toast('Map renamed', 'success');
      return;
    }
    try {
      const doc = await mapRepository.get(id);
      if (!doc) return;
      const next: MindMapDocument = { ...doc, title: clean, updatedAt: Date.now() };
      const saved = await queueStorageWrite(() => mapRepository.saveAtomic(next, readRevision(id)));
      publishSave(id, saved.revision, clean);
      actions.toast('Map renamed', 'success');
    } catch (error) {
      const message = error instanceof RevisionConflictError
        ? 'This map changed in another tab — reopen it before renaming'
        : describeStorageFailure(error);
      actions.setStorageError(message);
      actions.toast('Rename failed', 'error');
    }
  },

  async duplicate(id: string): Promise<void> {
    try {
      const source = await mapRepository.get(id);
      if (!source) {
        actions.toast('Could not duplicate this map', 'error');
        return;
      }
      const now = Date.now();
      const copy: MindMapDocument = {
        ...source,
        id: uid('map'),
        title: `${source.title} (copy)`,
        createdAt: now,
        updatedAt: now,
      };
      await copyImageBlobs(id, copy.id);
      const saved = await queueStorageWrite(() => mapRepository.saveAtomic(copy, readRevision(copy.id)));
      publishSave(copy.id, saved.revision, copy.title);
      actions.toast(`Duplicated as “${copy.title}”`, 'success');
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not duplicate this map', 'error');
    }
  },

  async remove(id: string): Promise<void> {
    const wasCurrent = currentDoc()?.id === id;
    if (wasCurrent) {
      // Deleting the open map discards it. Clearing the dirty flag first stops
      // the replacement path from flushing the doomed document back into storage.
      cancelAutoSave();
      actions.setUI({ dirty: false, savedAt: null });
    }
    try {
      // Queued separately: `versionRepository.clear` enqueues itself, and nesting
      // one queued write inside another would deadlock.
      await queueStorageWrite(() => mapRepository.remove(id));
      await deleteImageBlobs(id);
      await versionRepository.clear(id);
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not delete this map', 'error');
      if (wasCurrent) actions.setUI({ dirty: true });
      return;
    }
    if (wasCurrent) {
      try {
        const [next] = await mapRepository.list();
        if (next) await loadMap(next.id);
        else actions.closeDoc();
      } catch {
        actions.closeDoc();
      }
    }
    actions.closeDialog();
    actions.toast('Map deleted', 'success');
  },

  async importText(text: string, filename?: string): Promise<MindMapDocument | null> {
    try {
      const format = detectFormat(text, filename ?? '') ?? 'json';
      const parsed = format === 'json'
        ? isPortableMapText(text)
          ? parsePortableMap(text)
          : parseDocumentFromText(text)
        : parseForeignDocument(text, format, filename?.replace(/\.[^.]+$/, '') ?? 'Imported map');
      // Foreign formats are re-validated through the canonical parser as well.
      let doc = applyInitialLayout(format === 'json' ? parsed : parseDocument(parsed));
      doc.id = uid('map');
      doc = await prepareDocumentForStorage(doc);
      if (filename) {
        doc.title = filename.replace(/\.(json|mindmap|mm)$/i, '').replace(/[-_]/g, ' ').trim() || doc.title;
      }
      const repairs = getLastImportDiagnostics();
      guardUnsaved(() => {
        replaceDocument(doc);
        markUnsaved();
        actions.closeDialog();
        actions.setImportError(null);
        const stats = getStats(doc);
        if (repairs.length) {
          actions.toast(`Imported ${stats.nodes} nodes — ${repairs.length} repair${repairs.length === 1 ? '' : 's'} applied`, 'info');
          actions.setImportError({
            message: `Imported with ${repairs.length} automatic repair${repairs.length === 1 ? '' : 's'}`,
            details: repairs,
            filename: filename ?? 'Imported map',
          });
          actions.openDialog('importError');
        } else {
          actions.toast(`Imported ${stats.nodes} nodes`, 'success');
        }
      });
      return doc;
    } catch (error) {
      const message = error instanceof ImportError || error instanceof PortableMapError
        ? error.message
        : 'Import failed — unsupported file';
      const details = error instanceof ImportError || error instanceof PortableMapError ? error.details : [];
      actions.setImportError({ message, details, filename: filename ?? 'Unknown file' });
      actions.openDialog('importError');
      actions.toast(message, 'error');
      return null;
    }
  },

  async importFile(file: File): Promise<MindMapDocument | null> {
    try {
      const before = currentDoc();
      const text = await file.text();
      if (stale(before)) return null;
      return controller.importText(text, file.name);
    } catch {
      actions.setImportError({
        message: 'This file could not be read',
        details: [`${file.name} (${Math.round(file.size / 1024)} KB) could not be decoded as text.`],
        filename: file.name,
      });
      actions.openDialog('importError');
      actions.toast('Could not read this file', 'error');
      return null;
    }
  },

  /** AI boundary: every generated outline is schema-validated before it reaches the store. */
  async importAIOutline(text: string): Promise<MindMapDocument | null> {
    try {
      const parsed = parseAIDocument(JSON.parse(text) as unknown, 'AI generated map');
      let doc = applyInitialLayout(parseDocument(parsed));
      doc.id = uid('map');
      doc = await prepareDocumentForStorage(doc);
      guardUnsaved(() => {
        replaceDocument(doc);
        markUnsaved();
        actions.closeDialog();
        actions.setImportError(null);
        actions.toast(`AI outline imported — ${getStats(doc).nodes} nodes (validated)`, 'success');
      });
      return doc;
    } catch (error) {
      const message = error instanceof AIValidationError
        ? error.message
        : 'This AI outline is not valid JSON or did not match the expected schema.';
      const details = error instanceof AIValidationError
        ? error.issues
        : [error instanceof Error ? error.message : 'Unknown validation failure'];
      actions.setImportError({ message, details, filename: 'AI-generated outline' });
      actions.openDialog('importError');
      actions.toast(message, 'error');
      return null;
    }
  },

  /** Full diagnostic text for the "copy report" button in the import error dialog. */
  importReport(error: { message: string; details: string[]; filename: string } | null): string {
    if (!error) return '';
    return buildDiagnosticReport(error.filename, new ImportError(error.message, error.details));
  },

  /** Resolve the unsaved-changes prompt. Never discards work when saving fails. */
  async resolveUnsaved(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
    const pending = store.getState().ui.pendingAction;
    if (choice === 'cancel') {
      actions.closeDialog();
      actions.requestPending(null);
      return;
    }
    if (choice === 'save' && !(await controller.save())) {
      // Keep both the dialog and the deferred action so the user can retry.
      actions.toast('Save failed — nothing was discarded', 'error');
      return;
    }
    actions.closeDialog();
    actions.requestPending(null);
    pending?.();
  },

  /* ---------- persistent version history ---------- */

  listVersions(mapId?: string): Promise<VersionSummary[]> {
    const id = mapId ?? currentDoc()?.id;
    return id ? versionRepository.list(id) : Promise.resolve([]);
  },

  /** Named snapshot, always created even if the content has not changed. */
  async createSnapshot(label: string): Promise<VersionSummary | null> {
    const doc = currentDoc();
    if (!doc) return null;
    try {
      const snapshot = await versionRepository.save(doc, { kind: 'named', label, force: true });
      notifyVersionsChanged();
      actions.toast(snapshot ? `Snapshot “${snapshot.label}” saved` : 'Snapshot could not be saved', snapshot ? 'success' : 'error');
      return snapshot;
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Snapshot failed — browser storage may be full', 'error');
      return null;
    }
  },

  /**
   * Restore is reversible: the live document is snapshotted first, then the stored
   * copy becomes the current document and is flagged dirty so auto-save picks it up.
   */
  async restoreVersion(id: string): Promise<void> {
    guardUnsaved(async () => {
      const before = currentDoc();
      try {
        const doc = await versionRepository.get(id);
        if (stale(before)) return;
        if (!doc) {
          actions.toast('This snapshot could not be read', 'error');
          return;
        }
        const live = currentDoc();
        if (live) await versionRepository.save(live, { kind: 'named', label: 'Before restore', force: true }).catch(() => null);
        if (stale(before)) return;
        notifyVersionsChanged();
        replaceDocument(applyInitialLayout(doc), { markClean: false });
        markUnsaved();
        actions.closeDialog();
        actions.setSidebarTab('history');
        actions.toast(`Restored “${doc.title}” — save to keep it`, 'success');
      } catch (error) {
        actions.setStorageError(describeStorageFailure(error));
        actions.toast('Restore failed', 'error');
      }
    });
  },

  /** Restore as a brand-new independent map rather than overwriting the current one. */
  async duplicateVersion(id: string): Promise<void> {
    try {
      const doc = await versionRepository.get(id);
      if (!doc) {
        actions.toast('This snapshot could not be read', 'error');
        return;
      }
      const now = Date.now();
      const copy: MindMapDocument = { ...doc, id: uid('map'), title: `${doc.title} (from history)`, createdAt: now, updatedAt: now };
      await copyImageBlobs(doc.id, copy.id);
      const saved = await queueStorageWrite(() => mapRepository.saveAtomic(copy, readRevision(copy.id)));
      publishSave(copy.id, saved.revision, copy.title);
      actions.toast(`“${copy.title}” added to saved maps`, 'success');
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not duplicate this snapshot', 'error');
    }
  },

  async renameVersion(id: string, label: string): Promise<void> {
    try {
      await versionRepository.rename(id, label);
      notifyVersionsChanged();
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
    }
  },

  async deleteVersion(id: string): Promise<void> {
    try {
      await versionRepository.remove(id);
      notifyVersionsChanged();
      actions.toast('Snapshot deleted', 'success');
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not delete this snapshot', 'error');
    }
  },

  async clearVersions(): Promise<void> {
    const doc = currentDoc();
    if (!doc) return;
    try {
      await versionRepository.clear(doc.id);
      notifyVersionsChanged();
      actions.toast('Version history cleared', 'success');
    } catch (error) {
      actions.setStorageError(describeStorageFailure(error));
      actions.toast('Could not clear version history', 'error');
    }
  },
};
