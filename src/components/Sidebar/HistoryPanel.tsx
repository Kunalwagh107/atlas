import { useCallback, useEffect, useState } from 'react';
import type { VersionSummary } from '../../persistence/versions';
import { controller } from '../../state/controller';
import { useDerived } from '../../state/derived';
import { formatDateTime, plural } from '../../utils/common';
import { Icon } from '../common/Icon';

export const VERSIONS_CHANGED_EVENT = 'atlas:versions-changed';

/** Shared by the sidebar History tab and the full History dialog. */
export function HistoryPanel({ compact = false }: { compact?: boolean }) {
  const derived = useDerived();
  const doc = derived.doc;
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!doc) {
      setVersions([]);
      setLoading(false);
      return;
    }
    try {
      setVersions(await controller.listVersions(doc.id));
    } finally {
      setLoading(false);
    }
  }, [doc]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => void refresh();
    window.addEventListener(VERSIONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(VERSIONS_CHANGED_EVENT, onChange);
  }, [refresh]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    await controller.createSnapshot(label || `Snapshot · ${doc?.title ?? 'Map'}`);
    setLabel('');
    setBusy(false);
  };

  if (!doc) {
    return <div className="panel-empty"><Icon name="history" size={26} /><strong>No map open</strong><span>Open a map to see its version history.</span></div>;
  }

  return (
    <div className={`history-panel ${compact ? 'is-compact' : ''}`}>
      <div className="history-panel__create">
        <div className="field">
          <label className="field-label" htmlFor="snapshot-label">Named snapshot</label>
          <input
            id="snapshot-label"
            className="input input-sm"
            placeholder="e.g. Before restructuring"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void create(); }}
          />
        </div>
        <button type="button" className="btn btn-sm btn-primary btn-block" disabled={busy} onClick={() => void create()}>
          <Icon name="save" size={13} /> Save a snapshot
        </button>
        <p className="panel-note">
          Automatic snapshots are taken as you work (at most one every 45 seconds, 40 kept). Named
          snapshots are kept until you delete them.
        </p>
      </div>

      <div className="history-panel__head">
        <strong>{plural(versions.length, 'snapshot')}</strong>
        <button type="button" className="icon-btn tooltip-host" data-tooltip="Refresh" aria-label="Refresh history" onClick={() => void refresh()}>
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {loading ? (
        <div className="list-empty"><Icon name="clock" size={22} /><span>Loading history…</span></div>
      ) : versions.length === 0 ? (
        <div className="list-empty">
          <Icon name="history" size={26} />
          <strong>No snapshots yet</strong>
          <span>Save one above, or keep editing — Atlas will create them automatically.</span>
        </div>
      ) : (
        <ul className="history-list">
          {versions.map((version) => (
            <li key={version.id} className={`history-list__item ${version.kind === 'named' ? 'is-named' : ''}`}>
              <span className="history-list__icon"><Icon name={version.kind === 'named' ? 'star' : 'clock'} size={14} /></span>
              <div className="history-list__body">
                {editingId === version.id ? (
                  <input
                    className="input input-sm"
                    autoFocus
                    aria-label="Snapshot name"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={async () => {
                      if (draft.trim() && draft !== version.label) await controller.renameVersion(version.id, draft);
                      setEditingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') { setDraft(version.label); setEditingId(null); }
                    }}
                  />
                ) : (
                  <strong onDoubleClick={() => { setEditingId(version.id); setDraft(version.label); }} title="Double-click to rename">
                    {version.label}
                  </strong>
                )}
              </div>
              <span className="history-list__meta">
                {formatDateTime(version.createdAt)} · {plural(version.nodeCount, 'node')} · {version.kind === 'named' ? 'Named' : 'Auto'}
              </span>
              <div className="history-list__actions">
                <button type="button" className="btn btn-sm" onClick={() => void controller.restoreVersion(version.id)} title="Replace the current map with this snapshot">
                  Restore
                </button>
                <button type="button" className="icon-btn tooltip-host" data-tooltip="Save as a new map" aria-label="Duplicate snapshot as a new map" onClick={() => void controller.duplicateVersion(version.id)}>
                  <Icon name="duplicate" size={13} />
                </button>
                {confirmId === version.id ? (
                  <button type="button" className="btn btn-sm btn-danger" onClick={async () => { await controller.deleteVersion(version.id); setConfirmId(null); }}>Confirm</button>
                ) : (
                  <button type="button" className="icon-btn is-danger tooltip-host" data-tooltip="Delete snapshot" aria-label="Delete snapshot" onClick={() => setConfirmId(version.id)}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!compact && versions.length > 0 && (
        <div className="history-panel__foot">
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              if (window.confirm('Delete every snapshot for this map? This cannot be undone.')) await controller.clearVersions();
            }}
          >
            Clear all history
          </button>
        </div>
      )}
    </div>
  );
}
