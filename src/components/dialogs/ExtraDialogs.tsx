import { useEffect, useState } from 'react';
import { actions } from '../../state/actions';
import { controller } from '../../state/controller';
import { useDerived } from '../../state/derived';
import { depthFirstOrder, useAppStore } from '../../state/store';
import { copyText } from '../../utils/common';
import { Icon } from '../common/Icon';
import { HistoryPanel } from '../Sidebar/HistoryPanel';
import { Modal } from './Modal';

export function HistoryDialog() {
  return (
    <Modal
      title="Version history"
      subtitle="Snapshots are stored in this browser and survive reloads"
      icon="history"
      width={620}
      onClose={() => actions.closeDialog()}
      footer={<><div className="spacer" /><button type="button" className="btn btn-primary" onClick={() => actions.closeDialog()}>Done</button></>}
    >
      <HistoryPanel />
    </Modal>
  );
}

export function PresentationDialog() {
  const derived = useDerived();
  const doc = derived.doc;
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!doc) return;
    const explicit = doc.settings.presentationOrder.filter((id) => !!doc.nodes[id]);
    setOrder(explicit.length ? explicit : depthFirstOrder(doc));
  }, [doc]);

  if (!doc) return null;
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };
  const start = () => {
    actions.setPresentationOrder(order);
    actions.startPresentation(order);
  };

  return (
    <Modal
      title="Presentation mode"
      subtitle="Step through your map one node at a time"
      icon="presentation"
      width={560}
      onClose={() => actions.closeDialog()}
      footer={
        <>
          <button type="button" className="btn btn-sm" onClick={() => setOrder(depthFirstOrder(doc))}>Reset to tree order</button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => { actions.setPresentationOrder(order); actions.openDialog('gif'); }}>
            <Icon name="download" size={14} /> GIF
          </button>
          <button type="button" className="btn" onClick={() => actions.closeDialog()}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!order.length} onClick={start}>
            <Icon name="play" size={14} /> Start presenting
          </button>
        </>
      }
    >
      <p className="panel-note">
        Reorder the steps below, then start. Use <span className="kbd">←</span> / <span className="kbd">→</span> or
        Space to move between nodes and <span className="kbd">Esc</span> to exit. The order is saved with this map.
      </p>
      <ul className="presentation-order">
        {order.map((id, index) => (
          <li key={`${id}-${index}`}>
            <span className="presentation-order__index">{index + 1}</span>
            <span className="presentation-order__title" title={doc.nodes[id]?.title}>{doc.nodes[id]?.title ?? 'Missing node'}</span>
            <button type="button" className="icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><Icon name="arrow-up" size={13} /></button>
            <button type="button" className="icon-btn" aria-label="Move down" disabled={index === order.length - 1} onClick={() => move(index, 1)}><Icon name="arrow-down" size={13} /></button>
            <button type="button" className="icon-btn is-danger" aria-label="Remove step" onClick={() => setOrder(order.filter((_, i) => i !== index))}><Icon name="x" size={13} /></button>
          </li>
        ))}
      </ul>
      {order.length === 0 && <div className="list-empty"><Icon name="presentation" size={22} /><span>No steps — reset to tree order to begin.</span></div>}
    </Modal>
  );
}

export function UnsavedDialog() {
  const doc = useAppStore((s) => s.history.present);
  return (
    <Modal
      title="Unsaved changes"
      subtitle={`“${doc?.title ?? 'This map'}” has changes that have not been saved yet`}
      icon="alert"
      width={460}
      onClose={() => void controller.resolveUnsaved('cancel')}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void controller.resolveUnsaved('cancel')}>Cancel</button>
          <div className="spacer" />
          <button type="button" className="btn btn-danger" onClick={() => void controller.resolveUnsaved('discard')}>Discard changes</button>
          <button type="button" className="btn btn-primary" onClick={() => void controller.resolveUnsaved('save')}>Save &amp; continue</button>
        </>
      }
    >
      <div className="danger-note">
        <Icon name="save" size={20} />
        <div>
          <strong>Save before replacing this map?</strong>
          <p>Auto-save is off for this session. Saving keeps a copy in browser storage and adds a version snapshot.</p>
        </div>
      </div>
    </Modal>
  );
}

export function ImportErrorDialog() {
  const error = useAppStore((s) => s.ui.importError);
  const [copied, setCopied] = useState(false);
  if (!error) return null;
  const report = controller.importReport(error);
  return (
    <Modal
      title={error.details.length ? 'Import report' : 'Import failed'}
      subtitle={error.filename}
      icon={error.details.length ? 'info' : 'alert'}
      width={560}
      onClose={() => { actions.setImportError(null); actions.closeDialog(); }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const ok = await copyText(report);
              setCopied(ok);
              actions.toast(ok ? 'Diagnostic report copied' : 'Could not copy the report', ok ? 'success' : 'error');
            }}
          >
            <Icon name="copy" size={13} /> {copied ? 'Copied' : 'Copy report'}
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => { actions.setImportError(null); actions.openDialog('import'); }}>
            Try another file
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { actions.setImportError(null); actions.closeDialog(); }}>Close</button>
        </>
      }
    >
      <div className="import-report">
        <p className="import-report__message"><Icon name={error.details.length ? 'info' : 'alert'} size={15} /> {error.message}</p>
        {error.details.length > 0 && (
          <>
            <div className="import-report__title">Details</div>
            <ul>
              {error.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}
            </ul>
          </>
        )}
        <p className="panel-note">The original file was not modified. Fix the issues above and import again, or export a JSON copy of a working map to compare.</p>
      </div>
    </Modal>
  );
}
