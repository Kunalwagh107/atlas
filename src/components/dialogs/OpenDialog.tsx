import { useCallback, useEffect, useState } from 'react';
import type { MapSummary } from '../../core/mindmap/types';
import { mapRepository } from '../../persistence/indexeddb';
import { actions } from '../../state/actions';
import { controller } from '../../state/controller';
import { formatRelativeTime, plural } from '../../utils/common';
import { Icon } from '../common/Icon';
import { Modal } from './Modal';

export function OpenDialog() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(async () => {
    try {
      setMaps(await mapRepository.list());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = maps.filter((map) => map.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Modal
      title="Open a mind map"
      subtitle="Maps are stored privately in this browser"
      icon="folder-open"
      width={620}
      onClose={() => actions.closeDialog()}
      footer={
        <>
          <button type="button" className="btn" onClick={() => actions.openDialog('new')}><Icon name="file-plus" size={14} /> New map</button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => actions.openDialog('import')}><Icon name="upload" size={14} /> Import JSON</button>
          <button type="button" className="btn btn-primary" onClick={() => actions.closeDialog()}>Done</button>
        </>
      }
    >
      <div className="field">
        <input className="input" placeholder="Filter maps by name…" aria-label="Filter maps" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {loading ? (
        <div className="list-empty"><Icon name="clock" size={22} /><span>Loading saved maps…</span></div>
      ) : filtered.length === 0 ? (
        <div className="list-empty">
          <Icon name="map" size={26} />
          <strong>{maps.length ? 'No matching maps' : 'No saved maps yet'}</strong>
          <span>{maps.length ? 'Try a different search term.' : 'Create a map and save it to see it here.'}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => actions.openDialog('new')}>Create a map</button>
        </div>
      ) : (
        <ul className="map-list">
          {filtered.map((map) => (
            <li key={map.id} className="map-list__item">
              <span className="map-list__icon"><Icon name="map" size={17} /></span>
              <div className="map-list__body">
                {editingId === map.id ? (
                  <input
                    className="input"
                    autoFocus
                    value={draft}
                    aria-label="New map name"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={async () => {
                      if (draft.trim()) await controller.rename(map.id, draft);
                      setEditingId(null);
                      await refresh();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setDraft(map.title);
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <strong onDoubleClick={() => { setEditingId(map.id); setDraft(map.title); }}>{map.title}</strong>
                )}
                <span className="map-list__meta">{plural(map.nodeCount, 'node')} · Edited {formatRelativeTime(map.updatedAt)}</span>
              </div>
              <div className="map-list__actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void controller.open(map.id)}>Open</button>
                <button type="button" className="icon-btn tooltip-host" data-tooltip="Rename" aria-label="Rename" onClick={() => { setEditingId(map.id); setDraft(map.title); }}><Icon name="edit" size={14} /></button>
                <button type="button" className="icon-btn tooltip-host" data-tooltip="Duplicate" aria-label="Duplicate" onClick={async () => { await controller.duplicate(map.id); await refresh(); }}><Icon name="duplicate" size={14} /></button>
                <button
                  type="button"
                  className="icon-btn is-danger tooltip-host"
                  data-tooltip="Delete"
                  aria-label="Delete"
                  onClick={() => {
                    actions.setUI({ pendingDeleteMapId: map.id });
                    actions.openDialog('deleteConfirm');
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
