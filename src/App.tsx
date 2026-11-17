import { lazy, Suspense, useEffect } from 'react';
import { Canvas } from './components/Canvas/Canvas';
import { ContextMenu } from './components/dialogs/ContextMenu';
import { Dialogs } from './components/dialogs/Dialogs';
import { EmptyState } from './components/dialogs/EmptyState';
import { Icon } from './components/common/Icon';
import { Sidebar } from './components/Sidebar/Sidebar';
import { StatusBar } from './components/Toolbar/StatusBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { readLocalSettings, writeLocalSettings } from './persistence/indexeddb';
import { releaseImageObjectUrls } from './persistence/imageBlobs';
import { useServiceWorkerUpdate } from './pwa/useServiceWorkerUpdate';
import { actions } from './state/actions';
import { controller, scheduleAutoSave } from './state/controller';
import { DerivedProvider, useDerived } from './state/derived';
import { useAppStore, store } from './state/store';
import { isInteractiveTarget, isTextEditingTarget } from './utils/common';

const ShowcaseView = lazy(() => import('./showcase/ShowcaseView').then((module) => ({ default: module.ShowcaseView })));

function closeShowcase(): void {
  actions.setUI({ showcaseOpen: false });
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>('.toolbar button[aria-label="Product tour"]')?.focus();
  });
}

function useThemeSync(): void {
  const theme = useAppStore((s) => s.ui.theme);
  const autoSave = useAppStore((s) => s.ui.autoSave);
  const sidebarOpen = useAppStore((s) => s.ui.sidebarOpen);
  const hints = useAppStore((s) => s.ui.showShortcutHints);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1219' : '#f4f6fa');
  }, [theme]);

  useEffect(() => {
    writeLocalSettings({ ...readLocalSettings(), theme, autoSave, sidebarOpen, showShortcutHints: hints });
  }, [theme, autoSave, sidebarOpen, hints]);
}

function useBootstrap(): void {
  useEffect(() => {
    // Listen for other tabs before the first read, so a save that lands during
    // bootstrap is not missed.
    controller.initTabSync();
    const frame = requestAnimationFrame(() => void controller.bootstrap());
    return () => cancelAnimationFrame(frame);
  }, []);
}

/** The debounce itself lives in the controller so replacements can cancel/flush it. */
function useAutoSave(): void {
  useEffect(() => store.subscribe(scheduleAutoSave), []);
}

function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState();
      if (state.ui.dialog) {
        if (event.key === 'Escape') actions.closeDialog();
        return;
      }
      if (state.ui.presentation.active) {
        // A focused form control owns its keys: the speed <select> used to be
        // impossible to open because Space/Enter/arrows were swallowed first.
        if (isTextEditingTarget(event.target)) {
          if (event.key === 'Escape') {
            event.preventDefault();
            actions.endPresentation();
          }
          return;
        }
        // A focused button still needs Space/Enter to activate, but arrows are
        // free, so stepping the deck keeps working from the chrome.
        if (isInteractiveTarget(event.target) && (event.key === ' ' || event.key === 'Enter')) return;
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
          event.preventDefault();
          actions.presentationStep(1);
        } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key)) {
          event.preventDefault();
          actions.presentationStep(-1);
        } else if (event.key === 'Enter' && !isInteractiveTarget(event.target)) {
          event.preventDefault();
          actions.presentationStep(1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          actions.endPresentation();
        }
        return;
      }
      if (state.ui.showcaseOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeShowcase();
        }
        return;
      }
      if (state.ui.contextMenu.open) return;
      if (isTextEditingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      // Plain keys belong to focused buttons/tabs; modifier combos still work there.
      if (!mod && event.key !== 'Escape' && isInteractiveTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const selected = state.selection.primaryId;

      if (mod) {
        switch (key) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) actions.redo(); else actions.undo();
            return;
          case 'y':
            event.preventDefault();
            actions.redo();
            return;
          case 's':
            event.preventDefault();
            if (event.shiftKey) actions.openDialog('saveAs'); else void controller.save();
            return;
          case 'n':
            event.preventDefault();
            actions.openDialog('new');
            return;
          case 'o':
            event.preventDefault();
            actions.openDialog('open');
            return;
          case 'f':
            event.preventDefault();
            actions.focusSearch();
            return;
          case 'e':
            event.preventDefault();
            actions.openDialog('export');
            return;
          case 'i':
            if (event.shiftKey) { event.preventDefault(); actions.openDialog('import'); }
            return;
          case 'd':
            event.preventDefault();
            actions.duplicateSelected();
            return;
          case 'l':
            event.preventDefault();
            if (selected) actions.startLink(selected);
            return;
          case 'c':
            if (selected) { event.preventDefault(); actions.copyNode(selected); }
            return;
          case 'v':
            event.preventDefault();
            actions.paste();
            return;
          default:
            return;
        }
      }

      switch (event.key) {
        // Tab is left to the browser so toolbar/sidebar/dialog controls are
        // reachable by keyboard. A focused map node still handles Tab itself.
        case 'Insert':
          event.preventDefault();
          actions.addChild();
          break;
        case 'Enter':
          event.preventDefault();
          actions.addSibling();
          break;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          actions.deleteSelected();
          break;
        case 'Escape':
          if (state.ui.focusRootId) actions.setFocusRoot(null);
          else if (state.ui.linkSourceId) actions.cancelLink();
          else if (state.ui.editingNodeId) actions.setEditing(null);
          else { actions.clearSelection(); actions.closeContextMenu(); actions.selectEdge(null); }
          break;
        case 'F2':
          if (selected) { event.preventDefault(); actions.setEditing(selected); }
          break;
        case 'ArrowUp': event.preventDefault(); actions.navigate('up'); break;
        case 'ArrowDown': event.preventDefault(); actions.navigate('down'); break;
        case 'ArrowLeft': event.preventDefault(); actions.navigate('left'); break;
        case 'ArrowRight': event.preventDefault(); actions.navigate('right'); break;
        case '+':
        case '=': event.preventDefault(); actions.zoomIn(); break;
        case '-':
        case '_': event.preventDefault(); actions.zoomOut(); break;
        case '0': event.preventDefault(); actions.resetView(); break;
        case 'Home': event.preventDefault(); actions.center(); break;
        case 'f':
          event.preventDefault();
          if (event.shiftKey && selected) actions.toggleFocusRoot(selected);
          else actions.fit();
          break;
        case 'F':
          event.preventDefault();
          if (selected) actions.toggleFocusRoot(selected);
          else actions.fit();
          break;
        case 'p':
        case 'P': event.preventDefault(); actions.startPresentation(); break;
        case 'c':
        case 'C': if (selected) actions.toggleCollapse(selected); break;
        case '?': event.preventDefault(); actions.openDialog('shortcuts'); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Native "leave site?" confirmation for unsaved work (and failed auto-saves). */
function useBeforeUnload(): void {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const { ui, history } = store.getState();
      // With auto-save on, dirty only lasts for the 900 ms debounce — replacing the
      // document flushes that write. A storage failure means it will never land.
      if (ui.dirty && history.present && (!ui.autoSave || ui.storageError || ui.conflict)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}

function useFileDrop(): void {
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      // A local image dropzone handles its own files; never replace the map.
      if (event.defaultPrevented) return;
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      void controller.importFile(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}

/** Object URLs belong to the open map; revoke them when it is replaced. */
function useImageUrlLifecycle(): void {
  const mapId = useAppStore((s) => s.history.present?.id ?? null);
  useEffect(() => () => {
    if (mapId) releaseImageObjectUrls(mapId);
  }, [mapId]);
}

function UpdateBanner() {
  const { updateReady, applyUpdate } = useServiceWorkerUpdate();
  if (!updateReady) return null;
  return (
    <div className="update-banner" role="status" aria-live="polite">
      <Icon name="download" size={16} />
      <div className="update-banner__text">
        <strong>Update available</strong>
        <span>A newer Atlas version is ready. Reload when you are ready.</span>
      </div>
      <button type="button" className="btn btn-sm btn-primary" onClick={applyUpdate}>Reload</button>
    </div>
  );
}

function Toast() {
  const toast = useAppStore((s) => s.ui.toast);
  const dialogOpen = useAppStore((s) => s.ui.dialog !== null);
  const presenting = useAppStore((s) => s.ui.presentation.active);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => actions.setUI({ toast: null }), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.tone} ${dialogOpen || presenting ? 'toast--over-dialog' : ''}`} role="status" aria-live="polite" key={toast.id}>
      <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'} size={15} />
      <span>{toast.message}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => actions.setUI({ toast: null })}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

function Shell() {
  const derived = useDerived();
  const sidebarOpen = useAppStore((s) => s.ui.sidebarOpen);
  const showcaseOpen = useAppStore((s) => s.ui.showcaseOpen);

  return (
    <div className="app-shell" data-view={showcaseOpen ? 'showcase' : 'workspace'}>
      <Toolbar />
      <main
        className="workspace"
        data-sidebar={sidebarOpen ? 'open' : 'closed'}
        data-has-doc={derived.doc ? 'true' : 'false'}
        data-view={showcaseOpen ? 'showcase' : 'workspace'}
      >
        {showcaseOpen ? (
          <Suspense fallback={<div className="showcase-loading" role="status">Loading product tour…</div>}>
            <ShowcaseView onClose={closeShowcase} />
          </Suspense>
        ) : (
          <>
            {sidebarOpen && <Sidebar />}
            <Canvas />
            {!derived.doc && <EmptyState />}
          </>
        )}
      </main>
      {!showcaseOpen && <StatusBar />}
      <Dialogs />
      <ContextMenu />
      <UpdateBanner />
      <Toast />
    </div>
  );
}

export default function App() {
  useThemeSync();
  useBootstrap();
  useAutoSave();
  useGlobalShortcuts();
  useFileDrop();
  useBeforeUnload();
  useImageUrlLifecycle();

  return (
    <DerivedProvider>
      <Shell />
    </DerivedProvider>
  );
}
