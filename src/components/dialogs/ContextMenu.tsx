import { useEffect, useMemo, useRef } from 'react';
import { LAYOUTS, STYLE_PRESETS } from '../../core/mindmap/types';
import { actions } from '../../state/actions';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { clamp } from '../../utils/common';
import { Icon } from '../common/Icon';

interface Item {
  icon: string;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function MenuButton({ item, close }: { item: Item; close: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`context-item ${item.danger ? 'is-danger' : ''}`}
      disabled={item.disabled}
      onClick={() => {
        item.onClick();
        close();
      }}
    >
      <Icon name={item.icon} size={15} />
      <span>{item.label}</span>
      {item.shortcut && <kbd className="kbd">{item.shortcut}</kbd>}
    </button>
  );
}

export function ContextMenu() {
  const menu = useAppStore((s) => s.ui.contextMenu);
  const clipboard = useAppStore((s) => s.ui.clipboard);
  const derived = useDerived();
  const doc = derived.doc;
  const ref = useRef<HTMLDivElement>(null);

  const close = () => actions.closeContextMenu();

  useEffect(() => {
    if (!menu.open) return;
    const previous = document.activeElement as HTMLElement | null;
    const menuItems = () => Array.from(
      // Every focusable button, not just menuitems: the style presets and the
      // layout row are plain buttons and used to be unreachable by keyboard.
      ref.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled]), [role="menuitem"]:not([disabled])',
      ) ?? [],
    );
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      const buttons = menuItems();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
        event.preventDefault();
        if (!buttons.length) return;
        const delta = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
        buttons[index < 0 ? 0 : (index + delta + buttons.length) % buttons.length].focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        if (!buttons.length) return;
        buttons[event.key === 'Home' ? 0 : buttons.length - 1].focus();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    // Focus the first enabled item so the menu is usable without a mouse.
    const frame = requestAnimationFrame(() => menuItems()[0]?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      previous?.focus?.();
    };
  }, [menu.open]);

  const items = useMemo<Item[]>(() => {
    if (!menu.open) return [];
    if (menu.target === 'edge') {
      const edgeId = menu.targetId;
      return [
        { icon: 'edit', label: 'Edit connection label', onClick: () => { if (edgeId) actions.selectEdge(edgeId); actions.setUI({ sidebarTab: 'inspector', sidebarOpen: true }); } },
        { icon: 'link', label: 'Add another connection', onClick: () => { const source = edgeId ? doc?.edges[edgeId]?.source : null; if (source) actions.startLink(source); } },
        { icon: 'trash', label: 'Delete connection', danger: true, onClick: () => { if (edgeId) actions.removeEdge(edgeId); } },
      ];
    }
    if (menu.target === 'node' && menu.targetId) {
      const id = menu.targetId;
      const node = doc?.nodes[id];
      const isRoot = id === doc?.rootId;
      const hasChildren = (derived.byParent[id]?.length ?? 0) > 0;
      return [
        { icon: 'plus', label: 'Add child', shortcut: 'Tab / Ins', onClick: () => actions.addChild(id) },
        { icon: 'plus', label: 'Add sibling', shortcut: 'Enter', disabled: isRoot, onClick: () => actions.addSibling() },
        { icon: 'edit', label: 'Edit node', shortcut: 'F2', onClick: () => actions.setEditing(id) },
        { icon: 'layers', label: 'Rich content…', onClick: () => actions.openRichContent(id) },
        { icon: 'duplicate', label: 'Duplicate branch', shortcut: 'Ctrl+D', disabled: isRoot, onClick: () => actions.duplicateNode(id) },
        { icon: node?.collapsed ? 'expand' : 'collapse', label: node?.collapsed ? 'Expand branch' : 'Collapse branch', disabled: !hasChildren, onClick: () => actions.toggleCollapse(id) },
        { icon: 'link', label: 'Add connection', shortcut: 'Ctrl+L', onClick: () => actions.startLink(id) },
        { icon: 'copy', label: 'Copy branch', shortcut: 'Ctrl+C', onClick: () => actions.copyNode(id) },
        { icon: 'duplicate', label: 'Paste as child', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => actions.paste(id) },
        { icon: 'trash', label: 'Delete node', shortcut: 'Del', danger: true, disabled: isRoot, onClick: () => actions.deleteNode(id) },
      ];
    }
    return [
      { icon: 'plus', label: 'Add node here', onClick: () => actions.addNodeAt(menu.world) },
      { icon: 'duplicate', label: 'Paste branch here', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => actions.paste(undefined, menu.world) },
      { icon: 'fit', label: 'Fit view', shortcut: 'F', onClick: () => actions.fit() },
      { icon: 'center', label: 'Center map', onClick: () => actions.center() },
      { icon: 'focus', label: 'Reset view', shortcut: '0', onClick: () => actions.resetView() },
      { icon: 'refresh', label: 'Re-arrange', onClick: () => actions.applyLayout() },
      { icon: 'keyboard', label: 'Keyboard shortcuts', shortcut: '?', onClick: () => actions.openDialog('shortcuts') },
    ];
  }, [menu, doc, derived.byParent, clipboard]);

  if (!menu.open || !doc) return null;
  const width = menu.target === 'node' ? 248 : 232;
  const estimatedHeight = menu.target === 'node' ? 540 : 360;
  const left = clamp(menu.x, 8, Math.max(8, window.innerWidth - width - 8));
  const top = clamp(menu.y, 8, Math.max(8, window.innerHeight - estimatedHeight - 8));
  const selectedNode = menu.target === 'node' && menu.targetId ? doc.nodes[menu.targetId] : null;

  return (
    <div ref={ref} className="context-menu" style={{ left, top, width }} role="menu" aria-label="Context menu">
      {menu.target === 'node' && selectedNode && (
        <div className="context-menu__header">
          <Icon name="mouse-pointer" size={13} />
          <span title={selectedNode.title}>{selectedNode.title}</span>
        </div>
      )}
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`}>
          {(index === 4 || (menu.target === 'node' && index === 6) || (menu.target === 'canvas' && index === 2)) && <div className="context-menu__divider" />}
          <MenuButton item={item} close={close} />
        </div>
      ))}

      {menu.target === 'node' && selectedNode && (
        <>
          <div className="context-menu__divider" />
          <div className="context-menu__label">Change style</div>
          <div className="context-presets">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                aria-label={`Set style to ${preset.label}`}
                aria-pressed={selectedNode.style.preset === preset.value}
                className={selectedNode.style.preset === preset.value ? 'is-active' : ''}
                onClick={() => { actions.setNodeStyle(selectedNode.id, { preset: preset.value }, `preset:${selectedNode.id}`); close(); }}
              >
                <span style={{ background: preset.swatch }} />
                <Icon name={preset.icon} size={12} />
              </button>
            ))}
          </div>
        </>
      )}

      {menu.target === 'canvas' && (
        <>
          <div className="context-menu__divider" />
          <div className="context-menu__label">Layout</div>
          <div className="context-layouts">
            {LAYOUTS.map((layout) => (
              <button key={layout.value} type="button" aria-pressed={doc.settings.layout === layout.value} className={doc.settings.layout === layout.value ? 'is-active' : ''} onClick={() => { actions.changeLayout(layout.value); close(); }}>
                <Icon name={layout.value === 'tree' ? 'tree' : layout.value} size={14} />
                {layout.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
