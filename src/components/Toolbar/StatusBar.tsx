import { layoutLabel } from '../../core/mindmap/types';
import { useAppStore } from '../../state/store';
import { useDerived } from '../../state/derived';
import { actions } from '../../state/actions';
import { useStorageUsage } from '../common/useStorageUsage';
import { storageWarning } from '../../persistence/storageUsage';
import { Icon } from '../common/Icon';

export function StatusBar() {
  const derived = useDerived();
  const doc = derived.doc;
  const selection = useAppStore((s) => s.selection);
  const zoom = useAppStore((s) => s.viewport.zoom);
  const dirty = useAppStore((s) => s.ui.dirty);
  const autoSave = useAppStore((s) => s.ui.autoSave);
  const lastAction = useAppStore((s) => s.ui.lastAction);
  const theme = useAppStore((s) => s.ui.theme);
  const storageError = useAppStore((s) => s.ui.storageError);
  const usage = useStorageUsage();
  const warning = storageWarning(usage);

  const selected = selection.primaryId && doc ? doc.nodes[selection.primaryId] : null;

  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <span className={`status-dot ${dirty ? 'is-dirty' : ''}`} />
        <span>{doc ? (dirty ? (autoSave ? 'Saving…' : 'Unsaved changes') : 'All changes saved') : 'No map open'}</span>
      </div>
      <span className="statusbar__sep" />
      <div className="statusbar__group statusbar__stats">
        <Icon name="layers" size={13} />
        <span>{derived.stats.nodes} nodes</span>
        <span className="faint">·</span>
        <span>{derived.visibleIds.length} visible</span>
        <span className="faint">·</span>
        <span>{derived.stats.edges} links</span>
      </div>
      <span className="statusbar__sep" />
      <div className="statusbar__group statusbar__selection">
        <Icon name="mouse-pointer" size={13} />
        <span title={selected?.title}>{selected ? selected.title : 'Nothing selected'}</span>
      </div>
      <div className="spacer" />
      {warning && (
        <>
          <button
            type="button"
            className="statusbar__error"
            title={warning}
            onClick={() => actions.openDialog('settings')}
          >
            <Icon name="alert" size={13} /> Storage almost full
          </button>
          <span className="statusbar__sep" />
        </>
      )}
      {storageError && (
        <>
          <button
            type="button"
            className="statusbar__error"
            title={`${storageError} Click for details`}
            onClick={() => actions.toast(storageError, 'error')}
          >
            <Icon name="alert" size={13} /> Storage issue
          </button>
          <span className="statusbar__sep" />
        </>
      )}
      {lastAction && (
        <>
          <div className="statusbar__group faint statusbar__action">{lastAction}</div>
          <span className="statusbar__sep" />
        </>
      )}
      <div className="statusbar__group statusbar__layout">
        <Icon name="grid" size={13} />
        <span>{doc ? layoutLabel(doc.settings.layout) : 'No layout'}</span>
      </div>
      <span className="statusbar__sep" />
      <div className="statusbar__group statusbar__zoom">
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <span className="statusbar__sep" />
      <button type="button" className="statusbar__shortcuts" onClick={() => actions.openDialog('shortcuts')}>
        <Icon name="keyboard" size={13} /> Shortcuts <span className="kbd">?</span>
      </button>
      <span className="statusbar__sep" />
      <div className="statusbar__group statusbar__theme">
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={13} />
        <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
      </div>
    </footer>
  );
}
