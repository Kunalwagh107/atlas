import { useEffect, useMemo, useRef, useState } from 'react';
import { LAYOUTS } from '../../core/mindmap/types';
import { exportMap, type ExportFormat } from '../../export';
import { actions } from '../../state/actions';
import { controller } from '../../state/controller';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { debounce } from '../../utils/common';
import { Icon } from '../common/Icon';
import { SearchPanel } from './SearchPanel';

interface ToolbarButtonProps {
  icon: string;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  showLabel?: boolean;
  danger?: boolean;
}

function ToolbarButton({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  active,
  showLabel = false,
  danger,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`toolbar-btn tooltip-host ${showLabel ? 'toolbar-btn--label' : ''} ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`}
      data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={17} />
      {showLabel && <span>{label}</span>}
    </button>
  );
}

export function Toolbar() {
  const derived = useDerived();
  const doc = derived.doc;
  const canUndo = useAppStore((s) => s.history.past.length > 0);
  const canRedo = useAppStore((s) => s.history.future.length > 0);
  const zoom = useAppStore((s) => s.viewport.zoom);
  const theme = useAppStore((s) => s.ui.theme);
  const dirty = useAppStore((s) => s.ui.dirty);
  const searchOpen = useAppStore((s) => s.ui.searchOpen);
  const search = useAppStore((s) => s.search);
  const sidebarOpen = useAppStore((s) => s.ui.sidebarOpen);
  const showcaseOpen = useAppStore((s) => s.ui.showcaseOpen);
  const focusRootId = useAppStore((s) => s.ui.focusRootId);
  const selectedId = useAppStore((s) => s.selection.primaryId);
  const [menu, setMenu] = useState<'layout' | 'export' | null>(null);
  const [draft, setDraft] = useState(search.query);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useMemo(() => debounce((value: string) => actions.setSearch(value), 120), []);
  useEffect(() => setDraft(search.query), [search.query]);
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const doExport = async (format: ExportFormat) => {
    setMenu(null);
    try {
      await exportMap(format, derived, { scale: 2 });
      actions.toast(`${format.toUpperCase()} exported`, 'success');
    } catch (error) {
      actions.toast(error instanceof Error ? error.message : 'Export failed', 'error');
    }
  };

  return (
    <header className="toolbar" ref={menuRef}>
      <div className="brand" aria-label="Atlas mind map workspace">
        <div className="brand__mark"><Icon name="branch" size={18} strokeWidth={2} /></div>
        <div className="brand__text">
          <strong>Atlas</strong>
          <span>Mind map workspace</span>
        </div>
      </div>

      <span className="divider" />

      <ToolbarButton icon="panel-left" label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} onClick={() => actions.setUI({ sidebarOpen: !sidebarOpen })} active={sidebarOpen} />

      <span className="divider" />

      <div className="toolbar__group">
        <ToolbarButton icon="file-plus" label="New map" shortcut="Ctrl+N" onClick={() => actions.openDialog('new')} />
        <ToolbarButton icon="folder-open" label="Open map" shortcut="Ctrl+O" onClick={() => actions.openDialog('open')} />
        <ToolbarButton icon="save" label="Save" shortcut="Ctrl+S" onClick={() => void controller.save()} disabled={!doc} />
      </div>

      {doc && (
        <button type="button" className="doc-chip" onClick={() => actions.openDialog('rename')} title="Rename this map">
          <span className={`doc-chip__dot ${dirty ? 'is-dirty' : ''}`} />
          <span className="doc-chip__title">{doc.title}</span>
          <Icon name="chevron-down" size={13} />
        </button>
      )}

      <span className="divider" />

      <div className="toolbar__group">
        <ToolbarButton icon="undo" label="Undo" shortcut="Ctrl+Z" onClick={() => actions.undo()} disabled={!canUndo} />
        <ToolbarButton icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" onClick={() => actions.redo()} disabled={!canRedo} />
      </div>

      <span className="divider" />

      <ToolbarButton
        icon="book"
        label="Product tour"
        showLabel
        active={showcaseOpen}
        onClick={() => actions.setUI({ showcaseOpen: !showcaseOpen, searchOpen: false })}
      />

      <div className="spacer" />

      {searchOpen ? (
        <div className="search-wrap">
        <div className="search-bar">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            type="search"
            value={draft}
            placeholder="Search nodes…"
            aria-label="Search nodes"
            onChange={(event) => {
              setDraft(event.target.value);
              debouncedSearch(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                debouncedSearch.cancel();
                actions.clearSearch();
                setDraft('');
              } else if (event.key === 'Enter') {
                actions.searchStep(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className="search-bar__count">
            {search.query ? (search.matches.length ? `${search.activeIndex + 1}/${search.matches.length}` : 'No results') : ''}
          </span>
          <button type="button" className="icon-btn" aria-label="Previous result" disabled={!search.matches.length} onClick={() => actions.searchStep(-1)}>
            <Icon name="chevron-up" size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Next result" disabled={!search.matches.length} onClick={() => actions.searchStep(1)}>
            <Icon name="chevron-down" size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close search" onClick={() => actions.clearSearch()}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <SearchPanel />
        </div>
      ) : (
        <ToolbarButton icon="search" label="Search" shortcut="Ctrl+F" onClick={() => actions.focusSearch()} disabled={!doc} />
      )}

      <span className="divider" />

      <div className="toolbar__group zoom-group">
        <ToolbarButton icon="zoom-out" label="Zoom out" shortcut="−" onClick={() => actions.zoomOut()} disabled={!doc} />
        <button type="button" className="zoom-value" onClick={() => actions.setZoom(1)} title="Reset zoom to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarButton icon="zoom-in" label="Zoom in" shortcut="+" onClick={() => actions.zoomIn()} disabled={!doc} />
        <ToolbarButton icon="fit" label="Fit to screen" shortcut="F" onClick={() => actions.fit()} disabled={!doc} />
      </div>

      <span className="divider" />

      <div className="toolbar__group has-menus">
        <ToolbarButton
          icon="focus"
          label={focusRootId ? 'Exit focus mode (Shift+F)' : 'Focus on selected branch (Shift+F)'}
          active={!!focusRootId}
          disabled={!doc}
          onClick={() => {
            if (focusRootId) actions.setFocusRoot(null);
            else if (selectedId) actions.setFocusRoot(selectedId);
            else actions.toast('Select a node to focus on its branch', 'info');
          }}
        />
        <ToolbarButton icon="presentation" label="Presentation mode (P)" onClick={() => actions.openDialog('presentation')} disabled={!doc} />
        <ToolbarButton icon="history" label="Version history" onClick={() => actions.openDialog('history')} disabled={!doc} />
        <div className="menu-anchor">
          <ToolbarButton
            icon="layout"
            label="Layout"
            onClick={() => setMenu(menu === 'layout' ? null : 'layout')}
            active={menu === 'layout'}
            disabled={!doc}
          />
          {menu === 'layout' && (
            <div className="dropdown" role="menu">
              <div className="dropdown__title">Automatic layout</div>
              {LAYOUTS.map((layout) => (
                <button
                  key={layout.value}
                  type="button"
                  role="menuitem"
                  className={`dropdown__item ${doc?.settings.layout === layout.value ? 'is-active' : ''}`}
                  onClick={() => {
                    actions.changeLayout(layout.value);
                    setMenu(null);
                  }}
                >
                  <Icon name={layout.value === 'tree' ? 'tree' : layout.value} size={16} />
                  <span className="dropdown__item-text">
                    <strong>{layout.label}</strong>
                    <small>{layout.description}</small>
                  </span>
                  {doc?.settings.layout === layout.value && <Icon name="check" size={14} />}
                </button>
              ))}
              <div className="dropdown__divider" />
              <button type="button" className="dropdown__item" onClick={() => { actions.applyLayout(); setMenu(null); }}>
                <Icon name="refresh" size={16} />
                <span className="dropdown__item-text"><strong>Re-arrange now</strong><small>Snap nodes back to the current layout</small></span>
              </button>
            </div>
          )}
        </div>

        <div className="menu-anchor">
          <ToolbarButton icon="download" label="Export" onClick={() => setMenu(menu === 'export' ? null : 'export')} active={menu === 'export'} disabled={!doc} />
          {menu === 'export' && (
            <div className="dropdown" role="menu">
              <div className="dropdown__title">Export map</div>
              {([
                { format: 'json', icon: 'brackets', label: 'JSON', hint: 'Full-fidelity, re-importable' },
                { format: 'svg', icon: 'code', label: 'SVG', hint: 'Editable vector graphic' },
                { format: 'png', icon: 'image', label: 'PNG', hint: 'High-resolution image' },
                { format: 'pdf', icon: 'file', label: 'PDF', hint: 'Printable landscape page' },
              ] as const).map((item) => (
                <button key={item.format} type="button" className="dropdown__item" onClick={() => void doExport(item.format)}>
                  <Icon name={item.icon} size={16} />
                  <span className="dropdown__item-text"><strong>{item.label}</strong><small>{item.hint}</small></span>
                </button>
              ))}
              <div className="dropdown__divider" />
              <button type="button" className="dropdown__item" onClick={() => { setMenu(null); actions.openDialog('export'); }}>
                <Icon name="settings" size={16} />
                <span className="dropdown__item-text"><strong>Export options…</strong><small>Scale, padding and grid</small></span>
              </button>
              <button type="button" className="dropdown__item" onClick={() => { setMenu(null); actions.openDialog('import'); }}>
                <Icon name="upload" size={16} />
                <span className="dropdown__item-text"><strong>Import JSON…</strong><small>Open a saved map</small></span>
              </button>
            </div>
          )}
        </div>
      </div>

      <span className="divider" />

      <div className="toolbar__group toolbar__group--utility">
        <ToolbarButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => actions.toggleTheme()} />
        <ToolbarButton icon="keyboard" label="Keyboard shortcuts" shortcut="?" onClick={() => actions.openDialog('shortcuts')} />
        <ToolbarButton icon="settings" label="Settings" onClick={() => actions.openDialog('settings')} />
      </div>
    </header>
  );
}
