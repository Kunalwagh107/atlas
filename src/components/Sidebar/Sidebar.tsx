import { useState } from 'react';
import { layoutLabel } from '../../core/mindmap/types';
import { actions } from '../../state/actions';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { formatDateTime } from '../../utils/common';
import { Icon } from '../common/Icon';
import { useTabList } from '../common/useTabList';
import { Outline } from '../Outline/Outline';
import { HistoryPanel } from './HistoryPanel';
import { Inspector } from './Inspector';

const SIDEBAR_TABS = ['inspector', 'outline', 'history'] as const;
type SidebarTab = (typeof SIDEBAR_TABS)[number];

export function Sidebar() {
  const derived = useDerived();
  const doc = derived.doc;
  const tab = useAppStore((s) => s.ui.sidebarTab);
  const dirty = useAppStore((s) => s.ui.dirty);
  const savedAt = useAppStore((s) => s.ui.savedAt);
  const [infoOpen, setInfoOpen] = useState(true);
  const { tabProps, panelProps } = useTabList<SidebarTab>({
    ids: SIDEBAR_TABS,
    active: tab,
    onChange: (next) => actions.setSidebarTab(next),
    base: 'sidebar',
  });

  return (
    <aside className="sidebar" aria-label="Map properties and outline">
      <div className="sidebar__header">
        <div>
          <h2>Workspace</h2>
          <span>{doc ? 'Map details & structure' : 'No map open'}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Hide sidebar" title="Hide sidebar" onClick={() => actions.setUI({ sidebarOpen: false })}>
          <Icon name="panel-left" size={16} />
        </button>
      </div>

      <div className="sidebar__tabs" role="tablist" aria-label="Sidebar views" aria-orientation="horizontal">
        <button type="button" {...tabProps('inspector')} className={tab === 'inspector' ? 'is-active' : ''} onClick={() => actions.setUI({ sidebarTab: 'inspector' })}>
          <Icon name="settings" size={14} /> Inspector
        </button>
        <button type="button" {...tabProps('outline')} className={tab === 'outline' ? 'is-active' : ''} onClick={() => actions.setUI({ sidebarTab: 'outline' })}>
          <Icon name="list" size={14} /> Outline
          {doc && <span className="tab-badge">{derived.stats.nodes}</span>}
        </button>
        <button type="button" {...tabProps('history')} className={tab === 'history' ? 'is-active' : ''} onClick={() => actions.setSidebarTab('history')}>
          <Icon name="history" size={14} /> History
        </button>
      </div>

      {doc && (
        <div className="map-info">
          <button type="button" className="map-info__toggle" onClick={() => setInfoOpen((value) => !value)} aria-expanded={infoOpen}>
            <Icon name="file" size={14} />
            <span>Document</span>
            <Icon name={infoOpen ? 'chevron-up' : 'chevron-down'} size={13} />
          </button>
          {infoOpen && (
            <div className="map-info__body">
              <input
                className="input map-info__title"
                aria-label="Map title"
                value={doc.title}
                onChange={(event) => actions.setTitle(event.target.value)}
              />
              <div className="stat-grid">
                <div><strong>{derived.stats.nodes}</strong><span>Nodes</span></div>
                <div><strong>{derived.stats.branches}</strong><span>Branches</span></div>
                <div><strong>{derived.stats.edges}</strong><span>Links</span></div>
                <div><strong>{derived.stats.depth}</strong><span>Levels</span></div>
              </div>
              <div className="map-info__meta">
                <span><Icon name="clock" size={12} /> {dirty ? 'Unsaved changes' : savedAt ? `Saved ${formatDateTime(savedAt)}` : 'Not saved yet'}</span>
                <span><Icon name="layout" size={12} /> {layoutLabel(doc.settings.layout)}</span>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-sm" onClick={() => actions.openDialog('saveAs')}><Icon name="save" size={13} /> Save as</button>
                <button type="button" className="btn btn-sm" onClick={() => actions.openDialog('open')}><Icon name="folder-open" size={13} /> Open…</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="sidebar__content">
        <div {...panelProps('inspector')}><Inspector /></div>
        <div {...panelProps('outline')}><Outline /></div>
        <div {...panelProps('history')}><HistoryPanel compact /></div>
      </div>
    </aside>
  );
}
