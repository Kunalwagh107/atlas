import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { contentBadges } from '../../core/mindmap/content';
import { resolveNodeColors } from '../../core/mindmap/palette';
import { getChildren, getHiddenDescendantCount } from '../../core/mindmap/operations';
import { LAYOUT_SHORT_LABELS, NODE_TYPES, STYLE_PRESETS, type MindNode, type NodeStyle } from '../../core/mindmap/types';
import { actions } from '../../state/actions';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { Icon } from '../common/Icon';
import { ContentEditor } from './ContentEditor';

const ICON_CHOICES = ['', 'spark', 'star', 'bulb', 'help', 'note', 'check', 'book', 'link', 'target', 'diamond', 'alert', 'branch', 'layers'];

function Section({
  title, icon, action, children, id, className,
}: { title: string; icon: string; action?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section className={`panel-section ${className ?? ''}`} id={id}>
      <div className="panel-section__head">
        <span className="panel-section__title"><Icon name={icon} size={14} /> {title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Inspector() {
  const derived = useDerived();
  const doc = derived.doc;
  const selection = useAppStore((s) => s.selection);
  const selectedEdgeId = useAppStore((s) => s.ui.selectedEdgeId);
  const clipboard = useAppStore((s) => s.ui.clipboard);
  const focusRootId = useAppStore((s) => s.ui.focusRootId);
  const contentFocus = useAppStore((s) => s.ui.contentFocus);
  const node = selection.primaryId && doc ? doc.nodes[selection.primaryId] : null;
  const isRoot = node?.id === doc?.rootId;
  const richRef = useRef<HTMLDivElement>(null);
  const [richHighlighted, setRichHighlighted] = useState(false);

  // "Rich content" from the node toolbar / context menu scrolls the panel into
  // view instead of leaving the user at the top of a very long inspector.
  useEffect(() => {
    if (!contentFocus || !node) return;
    richRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setRichHighlighted(true);
    const timer = setTimeout(() => setRichHighlighted(false), 1800);
    return () => clearTimeout(timer);
  }, [contentFocus, node?.id]);

  const parentOptions = useMemo(() => {
    if (!doc || !node) return [];
    const descendants = new Set<string>([node.id]);
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const child of getChildren(doc, id)) {
        descendants.add(child.id);
        stack.push(child.id);
      }
    }
    return Object.values(doc.nodes)
      .filter((candidate) => !descendants.has(candidate.id))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [doc, node]);

  if (!doc) {
    return (
      <div className="panel-empty">
        <Icon name="map" size={26} />
        <strong>No map open</strong>
        <span>Create or open a map to see its properties here.</span>
      </div>
    );
  }

  const resolved = node ? resolveNodeColors(node, derived.branchIndices[node.id] ?? -1, derived.palette, !!isRoot) : null;
  const relations = Object.values(doc.edges).filter((edge) => edge.kind === 'relation');

  const setStyle = (patch: Partial<NodeStyle>, key?: string) => {
    if (node) actions.setNodeStyle(node.id, patch, `style:${node.id}:${key ?? 'general'}`);
  };

  return (
    <div className="inspector">
      <Section title="Map settings" icon="settings">
        <div className="layout-grid">
          {(['tree', 'horizontal', 'vertical', 'radial'] as const).map((layout) => (
            <button
              key={layout}
              type="button"
              className={`layout-grid__btn ${doc.settings.layout === layout ? 'is-active' : ''}`}
              onClick={() => actions.changeLayout(layout)}
              title={`Switch to ${layout} layout`}
            >
              <Icon name={layout === 'tree' ? 'tree' : layout} size={17} />
              <span>{LAYOUT_SHORT_LABELS[layout]}</span>
            </button>
          ))}
        </div>
        <div className="switch-row">
          <label className="switch">
            <input type="checkbox" checked={doc.settings.autoArrange} onChange={(event) => actions.setAutoArrange(event.target.checked)} />
            <span className="switch-track" />
            <span>Auto-arrange on edit</span>
          </label>
        </div>
        <div className="switch-row">
          <label className="switch">
            <input type="checkbox" checked={doc.settings.showDescriptions} onChange={(event) => actions.updateSettings({ showDescriptions: event.target.checked })} />
            <span className="switch-track" />
            <span>Show descriptions</span>
          </label>
        </div>
        <div className="switch-row">
          <label className="switch">
            <input type="checkbox" checked={doc.settings.showGrid} onChange={(event) => actions.updateSettings({ showGrid: event.target.checked })} />
            <span className="switch-track" />
            <span>Dot grid</span>
          </label>
        </div>
        <div className="switch-row">
          <label className="switch">
            <input type="checkbox" checked={doc.settings.showMinimap} onChange={(event) => actions.updateSettings({ showMinimap: event.target.checked })} />
            <span className="switch-track" />
            <span>Overview map</span>
          </label>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={() => actions.applyLayout()}><Icon name="refresh" size={13} /> Re-arrange</button>
          <button type="button" className="btn btn-sm" onClick={() => actions.resetToAutoLayout()} title="Return every node to automatic layout"><Icon name="target" size={13} /> Reset positions</button>
          <button type="button" className="btn btn-sm" onClick={() => actions.setAllCollapsed(true)}><Icon name="collapse" size={13} /> Collapse all</button>
          <button type="button" className="btn btn-sm" onClick={() => actions.setAllCollapsed(false)}><Icon name="expand" size={13} /> Expand all</button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" disabled={!node} onClick={() => node && actions.toggleFocusRoot(node.id)}>
            <Icon name="focus" size={13} /> {focusRootId ? 'Exit focus' : 'Focus branch'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => actions.openDialog('presentation')}>
            <Icon name="presentation" size={13} /> Present…
          </button>
          <button type="button" className="btn btn-sm" onClick={() => actions.openDialog('history')}>
            <Icon name="history" size={13} /> History
          </button>
        </div>
        {selection.ids.length > 1 && (
          <div className="bulk-actions">
            <span className="chip">{selection.ids.length} selected</span>
            <div className="btn-row">
              {([
                { icon: 'align-left', align: 'left', label: 'Align left' },
                { icon: 'align-center', align: 'centerX', label: 'Align centre' },
                { icon: 'align-right', align: 'right', label: 'Align right' },
                { icon: 'align-top', align: 'top', label: 'Align top' },
                { icon: 'align-middle', align: 'centerY', label: 'Align middle' },
                { icon: 'align-bottom', align: 'bottom', label: 'Align bottom' },
              ] as const).map((item) => (
                <button key={item.align} type="button" className="icon-btn tooltip-host" data-tooltip={item.label} aria-label={item.label} onClick={() => actions.alignNodes(selection.ids, item.align)}>
                  <Icon name={item.icon} size={14} />
                </button>
              ))}
              <button type="button" className="btn btn-sm" disabled={selection.ids.length < 3} onClick={() => actions.distributeNodes(selection.ids, 'x')} title="Distribute horizontally">Distribute X</button>
              <button type="button" className="btn btn-sm" disabled={selection.ids.length < 3} onClick={() => actions.distributeNodes(selection.ids, 'y')} title="Distribute vertically">Distribute Y</button>
              <button type="button" className="btn btn-sm" onClick={() => actions.groupNodes(selection.ids, 'New group')}><Icon name="group" size={12} /> Group</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => actions.deleteNodes(selection.ids)}><Icon name="trash" size={12} /> Delete selected</button>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Selected node"
        icon="mouse-pointer"
        action={node ? <span className="chip">{node.type}</span> : undefined}
      >
        {!node ? (
          <div className="panel-hint">
            <Icon name="mouse-pointer" size={16} />
            <span>Click a node on the canvas to edit its content and appearance.</span>
          </div>
        ) : (
          <>
            <div className="field">
              <label className="field-label" htmlFor="node-title">Title</label>
              <input
                id="node-title"
                className="input"
                value={node.title}
                onChange={(event) => actions.editNode(node.id, { title: event.target.value }, 'Edit node title')}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="node-desc">Notes / details</label>
              <textarea
                id="node-desc"
                className="textarea"
                placeholder="Add context, a definition, a source…"
                value={node.description}
                onChange={(event) => actions.editNode(node.id, { description: event.target.value }, 'Edit node notes')}
              />
            </div>
            <button type="button" className="btn btn-sm btn-block rich-jump" onClick={() => actions.openRichContent(node.id)}>
              <Icon name="layers" size={13} /> Rich content — notes, links, images, tasks…
            </button>
            <div className="field-2">
              <div className="field">
                <label className="field-label" htmlFor="node-type">Node type</label>
                <select
                  id="node-type"
                  className="select"
                  value={node.type}
                  onChange={(event) => actions.editNode(node.id, { type: event.target.value as MindNode['type'] }, 'Change node type')}
                  disabled={isRoot}
                >
                  {NODE_TYPES.filter((type) => isRoot ? type.value === 'central' : type.value !== 'central').map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="node-icon">Icon</label>
                <select id="node-icon" className="select" value={node.style.icon ?? ''} onChange={(event) => setStyle({ icon: event.target.value || undefined }, 'icon')}>
                  {ICON_CHOICES.map((icon) => <option key={icon} value={icon}>{icon || 'Automatic'}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <span className="field-label">Style preset</span>
              <div className="preset-grid">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`preset-grid__btn ${node.style.preset === preset.value ? 'is-active' : ''}`}
                    onClick={() => setStyle({ preset: preset.value }, 'preset')}
                    title={preset.label}
                  >
                    <span className="preset-grid__dot" style={{ background: preset.swatch }} />
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <div className="slider-head">
                <span className="field-label">Font size</span>
                <span className="mono faint">{node.style.fontSize}px</span>
              </div>
              <input type="range" min={10} max={24} step={1} value={node.style.fontSize} onChange={(event) => setStyle({ fontSize: Number(event.target.value) }, 'font-size')} />
            </div>
            <div className="field-2">
              <div className="field">
                <div className="slider-head"><span className="field-label">Corner radius</span><span className="mono faint">{node.style.borderRadius}px</span></div>
                <input type="range" min={0} max={24} step={1} value={node.style.borderRadius} onChange={(event) => setStyle({ borderRadius: Number(event.target.value) }, 'radius')} />
              </div>
              <div className="field">
                <div className="slider-head"><span className="field-label">Weight</span><span className="mono faint">{node.style.fontWeight}</span></div>
                <input type="range" min={300} max={800} step={20} value={node.style.fontWeight} onChange={(event) => setStyle({ fontWeight: Number(event.target.value) }, 'weight')} />
              </div>
            </div>
            <div className="field">
              <div className="slider-head">
                <span className="field-label">Node width</span>
                <span className="mono faint">{node.style.width ? `${node.style.width}px` : 'Auto'}</span>
              </div>
              <input aria-label="Node width" type="range" min={120} max={420} step={10} value={node.style.width ?? 180} onChange={(event) => setStyle({ width: Number(event.target.value) }, 'width')} />
            </div>
            <div className="field">
              <div className="slider-head">
                <span className="field-label">Node height</span>
                <span className="mono faint">{node.style.height ? `${node.style.height}px` : 'Auto'}</span>
              </div>
              <input aria-label="Node height" type="range" min={44} max={320} step={4} value={node.style.height ?? 48} onChange={(event) => setStyle({ height: Number(event.target.value) }, 'height')} />
              {(node.style.width || node.style.height) && (
                <button type="button" className="link-btn" onClick={() => setStyle({ width: undefined, height: undefined }, 'size-reset')}>Reset to auto size</button>
              )}
              <span className="panel-note">Or drag a corner of the selected node on the canvas.</span>
            </div>

            <div className="field">
              <span className="field-label">Colors</span>
              <div className="color-row">
                <label className="color-field">
                  <input type="color" value={node.style.background ?? resolved?.background ?? '#ffffff'} onChange={(event) => setStyle({ background: event.target.value }, 'bg')} />
                  <span>Background</span>
                </label>
                <label className="color-field">
                  <input type="color" value={node.style.textColor ?? resolved?.text ?? '#1c2534'} onChange={(event) => setStyle({ textColor: event.target.value }, 'text')} />
                  <span>Text</span>
                </label>
                <label className="color-field">
                  <input type="color" value={node.style.borderColor ?? resolved?.border ?? '#dfe4ec'} onChange={(event) => setStyle({ borderColor: event.target.value }, 'border')} />
                  <span>Border</span>
                </label>
              </div>
              {(node.style.background || node.style.textColor || node.style.borderColor) && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setStyle({ background: undefined, textColor: undefined, borderColor: undefined }, 'color-reset')}
                >
                  Reset custom colors
                </button>
              )}
            </div>

            <div className="field">
              <span className="field-label">Branch management</span>
              <div className="field-2">
                <select
                  className="select"
                  aria-label="Move branch under"
                  value={node.parentId ?? ''}
                  onChange={(event) => event.target.value && actions.reparent(node.id, event.target.value)}
                  disabled={isRoot}
                >
                  <option value="">Move under…</option>
                  {parentOptions.filter((option) => option.id !== node.parentId).map((option) => (
                    <option key={option.id} value={option.id}>{option.title.slice(0, 40)}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-sm" disabled={isRoot || !getChildren(doc, node.id).length} onClick={() => actions.toggleCollapse(node.id)}>
                  <Icon name={node.collapsed ? 'expand' : 'collapse'} size={13} />
                  {node.collapsed ? 'Expand' : 'Collapse'}
                </button>
              </div>
              <div className="node-meta">
                <span>{getChildren(doc, node.id).length} direct children</span>
                <span>{getHiddenDescendantCount(doc, node.id)} descendants</span>
              </div>
            </div>

            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => actions.addChild(node.id)}><Icon name="plus" size={13} /> Child</button>
              <button type="button" className="btn btn-sm" onClick={() => actions.addSibling()} disabled={isRoot}><Icon name="plus" size={13} /> Sibling</button>
              <button type="button" className="btn btn-sm" onClick={() => actions.copyNode(node.id)}><Icon name="copy" size={13} /> Copy</button>
              <button type="button" className="btn btn-sm" onClick={() => actions.paste(node.id)} disabled={!clipboard}><Icon name="duplicate" size={13} /> Paste</button>
              <button type="button" className="btn btn-sm btn-danger" disabled={isRoot} onClick={() => actions.deleteNode(node.id)}><Icon name="trash" size={13} /> Delete</button>
            </div>
          </>
        )}
      </Section>

      {node && (
        <Section
          title="Rich content"
          icon="layers"
          id="rich-content-section"
          className={richHighlighted ? 'is-highlighted' : ''}
          action={<span className="chip">{contentBadges(node.content).length || '—'}</span>}
        >
          <div ref={richRef} />
          <ContentEditor key={node.id} node={node} />
        </Section>
      )}

      <Section
        title="Connections"
        icon="link"
        action={<span className="chip">{relations.length}</span>}
      >
        <button type="button" className="btn btn-sm btn-block" onClick={() => node && actions.startLink(node.id)} disabled={!node}>
          <Icon name="link" size={13} /> {node ? 'Connect this node…' : 'Select a node to connect'}
        </button>
        {relations.length === 0 ? (
          <p className="panel-note">No cross-links yet. Relate two ideas without changing the hierarchy.</p>
        ) : (
          <ul className="relation-list">
            {relations.map((edge) => (
              <li key={edge.id} className={selectedEdgeId === edge.id ? 'is-active' : ''}>
                <button type="button" className="relation-list__label" onClick={() => actions.focusNode(edge.target)}>
                  <span>{doc.nodes[edge.source]?.title ?? '?'}</span>
                  <Icon name="chevron-right" size={12} />
                  <span>{doc.nodes[edge.target]?.title ?? '?'}</span>
                </button>
                <button type="button" className="icon-btn is-danger" aria-label="Remove connection" onClick={() => actions.removeEdge(edge.id)}>
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedEdgeId && doc.edges[selectedEdgeId] && (
          <div className="field">
            <label className="field-label" htmlFor="edge-label">Connection label</label>
            <input
              id="edge-label"
              className="input"
              placeholder="e.g. depends on"
              value={doc.edges[selectedEdgeId].label}
              onChange={(event) => actions.setEdgeLabel(selectedEdgeId, event.target.value)}
            />
          </div>
        )}
      </Section>

      <div className="panel-footer-note">
        <Icon name="info" size={13} /> Changes are saved automatically in this browser.
      </div>
    </div>
  );
}
