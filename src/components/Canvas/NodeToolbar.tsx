import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { STYLE_PRESETS, type MindNode } from '../../core/mindmap/types';
import { actions } from '../../state/actions';
import { Icon } from '../common/Icon';

export interface NodeToolbarProps {
  node: MindNode;
  left: number;
  top: number;
  canDelete: boolean;
  placement?: 'above' | 'below' | 'side';
}

interface ToolButton {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface BaseButton {
  id: string;
  icon: string;
  label: string;
  danger?: boolean;
}

/** The buttons every node gets, in order. `size` is added only for a node with
 *  an explicit width or height (see `hasFixedSize`). */
const BASE_BUTTONS: BaseButton[] = [
  { id: 'add', icon: 'plus', label: 'Add child (Tab)' },
  { id: 'edit', icon: 'edit', label: 'Edit node (double-click)' },
  { id: 'content', icon: 'layers', label: 'Rich content — notes, links, images' },
  { id: 'style', icon: 'palette', label: 'Change style' },
  { id: 'link', icon: 'link', label: 'Add connection' },
  { id: 'duplicate', icon: 'duplicate', label: 'Duplicate branch' },
  { id: 'delete', icon: 'trash', label: 'Delete node (Delete)', danger: true },
];

// The toolbar's own metrics (see .node-toolbar in canvas.css and refresh.css),
// so the canvas can place it without measuring: 30px buttons, 2px apart, 5px of
// padding and a 1px border each side.
const BUTTON = 30;
const GAP = 2;
const PAD = 5;

/** Corner-drag resizing (or the inspector's sliders) pin an explicit size. */
export function hasFixedSize(node: MindNode): boolean {
  return Boolean(node.style.width || node.style.height);
}

/** How wide the toolbar will be, for centring it over the node. */
export function nodeToolbarWidth(node: MindNode, canDelete: boolean): number {
  const count = BASE_BUTTONS.filter((button) => canDelete || !button.danger).length + (hasFixedSize(node) ? 1 : 0);
  return count * BUTTON + (count - 1) * GAP + PAD * 2 + 2;
}

export function NodeToolbar({ node, left, top, canDelete, placement = 'above' }: NodeToolbarProps) {
  const [styleOpen, setStyleOpen] = useState(false);
  const stop = (event: ReactPointerEvent) => event.stopPropagation();

  const run: Record<string, () => void> = {
    add: () => actions.addChild(node.id),
    edit: () => actions.setEditing(node.id),
    content: () => actions.openRichContent(node.id),
    style: () => setStyleOpen((v) => !v),
    link: () => actions.startLink(node.id),
    duplicate: () => actions.duplicateNode(node.id),
    delete: () => actions.deleteNode(node.id),
    size: () => actions.setNodeStyle(node.id, { width: undefined, height: undefined }, 'size-reset'),
  };

  const visible = BASE_BUTTONS.filter((button) => canDelete || !button.danger);
  const buttons: ToolButton[] = visible.map((button) => ({
    icon: button.icon,
    label: button.label,
    danger: button.danger,
    onClick: run[button.id],
  }));

  // Only a node whose size was pinned can go back to auto: the action would do
  // nothing on a node that already hugs its text. It sits with the style
  // controls, before the connection tools.
  if (hasFixedSize(node)) {
    const at = visible.findIndex((button) => button.id === 'link');
    buttons.splice(at < 0 ? buttons.length : at, 0, {
      icon: 'fit',
      label: 'Reset to auto size',
      onClick: run.size,
    });
  }

  return (
    <div
      className={`node-toolbar ${placement === 'side' ? 'is-side' : ''}`}
      style={{ left, top }}
      onPointerDown={stop}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          className={`node-toolbar__btn tooltip-host ${button.danger ? 'is-danger' : ''} ${button.icon === 'palette' && styleOpen ? 'is-active' : ''}`}
          data-tooltip={button.label}
          aria-label={button.label}
          onClick={() => button.onClick()}
        >
          <Icon name={button.icon} size={15} />
        </button>
      ))}
      {styleOpen && (
        <div className="style-popover" role="menu" aria-label="Node styles">
          <div className="style-popover__title">Node style</div>
          <div className="style-popover__grid">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                role="menuitem"
                className={`style-popover__item ${node.style.preset === preset.value ? 'is-active' : ''}`}
                onClick={() => {
                  actions.setNodeStyle(node.id, { preset: preset.value }, `preset:${node.id}`);
                  setStyleOpen(false);
                }}
              >
                <span className="style-popover__swatch" style={{ background: preset.swatch }} />
                <Icon name={preset.icon} size={13} />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
          {hasFixedSize(node) && (
            <button
              type="button"
              role="menuitem"
              className="style-popover__reset"
              onClick={() => {
                run.size();
                setStyleOpen(false);
              }}
            >
              <Icon name="fit" size={13} />
              <span>Reset to auto size</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
