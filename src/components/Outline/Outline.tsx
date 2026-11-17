import { useEffect, useMemo, useRef, useState } from 'react';
import { STYLE_PRESETS, type MindNode } from '../../core/mindmap/types';
import { actions } from '../../state/actions';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { Icon } from '../common/Icon';

function nodeIcon(node: MindNode, isRoot: boolean): string {
  if (isRoot) return 'spark';
  const preset = STYLE_PRESETS.find((p) => p.value === node.style.preset);
  if (preset && node.style.preset !== 'default') return preset.icon;
  const byType: Record<string, string> = {
    topic: 'branch', subtopic: 'circle', note: 'note', question: 'help',
    example: 'bulb', task: 'check', reference: 'link',
  };
  return byType[node.type] ?? 'circle';
}

interface RowProps {
  node: MindNode;
  level: number;
  byParent: Record<string, MindNode[]>;
  rootId: string;
  selectedId: string | null;
  matches: Set<string>;
}

function OutlineRow({ node, level, byParent, rootId, selectedId, matches }: RowProps) {
  const children = byParent[node.id] ?? [];
  const isRoot = node.id === rootId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(node.title), [node.title]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const clean = draft.trim();
    if (clean && clean !== node.title) actions.editNode(node.id, { title: clean }, 'Edit from outline');
  };

  return (
    <>
      <div
        className={`outline-row ${selectedId === node.id ? 'is-selected' : ''} ${matches.has(node.id) ? 'is-match' : ''}`}
        style={{ paddingLeft: 8 + level * 15 }}
        onClick={() => actions.select([node.id], { focus: true })}
        onDoubleClick={() => setEditing(true)}
        role="treeitem"
        aria-selected={selectedId === node.id}
        aria-expanded={children.length ? !node.collapsed : undefined}
        tabIndex={0}
        onKeyDown={(event) => {
          // The row owns these keys: without stopPropagation the global handler
          // also runs and Enter would add a sibling while the editor opens.
          if (event.key === 'Enter' && !editing) {
            event.preventDefault();
            event.stopPropagation();
            actions.setEditing(node.id);
          } else if (event.key === 'F2' && !editing) {
            event.preventDefault();
            event.stopPropagation();
            actions.setEditing(node.id);
          } else if ((event.key === 'Delete' || event.key === 'Backspace') && !editing) {
            event.preventDefault();
            event.stopPropagation();
            actions.deleteNodes([node.id]);
          }
        }}
      >
        <button
          type="button"
          className={`outline-row__disclosure ${children.length ? '' : 'is-empty'}`}
          aria-label={node.collapsed ? 'Expand branch' : 'Collapse branch'}
          onClick={(event) => {
            event.stopPropagation();
            if (children.length) actions.toggleCollapse(node.id);
          }}
        >
          <Icon name={children.length ? (node.collapsed ? 'chevron-right' : 'chevron-down') : 'circle'} size={children.length ? 13 : 5} />
        </button>
        <span className="outline-row__icon"><Icon name={nodeIcon(node, isRoot)} size={13} /></span>
        {editing ? (
          <input
            ref={inputRef}
            className="outline-row__input"
            value={draft}
            aria-label="Edit node title"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') { setDraft(node.title); setEditing(false); }
            }}
          />
        ) : (
          <span className="outline-row__title" title={node.title}>{node.title}</span>
        )}
        {node.collapsed && children.length > 0 && <span className="outline-row__collapsed">+{children.length}</span>}
        {node.description && <span className="outline-row__note" title="Has notes"><Icon name="note" size={12} /></span>}
        <div className="outline-row__actions">
          <button type="button" className="icon-btn" aria-label="Add child" title="Add child" onClick={(event) => { event.stopPropagation(); actions.addChild(node.id); }}>
            <Icon name="plus" size={13} />
          </button>
          <button type="button" className="icon-btn" aria-label="Edit node" title="Edit" onClick={(event) => { event.stopPropagation(); setEditing(true); }}>
            <Icon name="edit" size={13} />
          </button>
          {!isRoot && (
            <button type="button" className="icon-btn is-danger" aria-label="Delete node" title="Delete" onClick={(event) => { event.stopPropagation(); actions.deleteNode(node.id); }}>
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
      </div>
      {!node.collapsed && children.map((child) => (
        <OutlineRow
          key={child.id}
          node={child}
          level={level + 1}
          byParent={byParent}
          rootId={rootId}
          selectedId={selectedId}
          matches={matches}
        />
      ))}
    </>
  );
}

export function Outline() {
  const derived = useDerived();
  const doc = derived.doc;
  const selectedId = useAppStore((s) => s.selection.primaryId);
  const search = useAppStore((s) => s.search);
  const matches = useMemo(() => new Set(search.matches), [search.matches]);

  if (!doc) {
    return <div className="panel-empty"><Icon name="list" size={26} /><strong>No outline</strong><span>Open a map to browse its hierarchy.</span></div>;
  }

  return (
    <div className="outline">
      <div className="outline__toolbar">
        <span className="chip"><Icon name="layers" size={12} /> {derived.stats.nodes} nodes · {derived.stats.depth} levels</span>
        <div className="spacer" />
        <button type="button" className="icon-btn tooltip-host" data-tooltip="Expand all" aria-label="Expand all" onClick={() => actions.setAllCollapsed(false)}><Icon name="expand" size={15} /></button>
        <button type="button" className="icon-btn tooltip-host" data-tooltip="Collapse all" aria-label="Collapse all" onClick={() => actions.setAllCollapsed(true)}><Icon name="collapse" size={15} /></button>
      </div>
      <div className="outline__tree" role="tree" aria-label="Mind map outline">
        <OutlineRow
          node={doc.nodes[doc.rootId]}
          level={0}
          byParent={derived.byParent}
          rootId={doc.rootId}
          selectedId={selectedId}
          matches={matches}
        />
      </div>
      <div className="outline__footer">
        <button type="button" className="btn btn-sm btn-block" onClick={() => actions.addChild(selectedId ?? doc.rootId)}>
          <Icon name="plus" size={13} /> Add child to selected node
        </button>
        <p className="panel-note">Click to focus a node · double-click to rename · use the chevron to collapse a branch.</p>
      </div>
    </div>
  );
}
