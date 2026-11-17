import type { CSSProperties } from 'react';
import type { Act } from '../stageshow/kit/act';
import { Button } from '../stageshow/kit/controls/Button';
import { Row } from '../stageshow/kit/parts/Row';
import { Stage } from '../stageshow/kit/stage';
import { Text, Window } from '../stageshow/kit/window';
import { Icon } from '../components/common/Icon';
import './atlas-demo.css';

type DemoState = {
  hover: boolean;
  selected: boolean;
  editing: boolean;
  typing: string;
  added: boolean;
  saving: boolean;
};

const initial: DemoState = {
  hover: false,
  selected: false,
  editing: false,
  typing: '',
  added: false,
  saving: false,
};

const poster: DemoState = {
  hover: false,
  selected: true,
  editing: false,
  typing: 'Press kit',
  added: true,
  saving: false,
};

async function script(a: Act<DemoState>) {
  await a.wait(800);

  // 1. Select the Channels branch.
  a.mark('select');
  await a.move({ at: 'channels', x: 0.72, y: 0.58 });
  await a.set({ hover: true });
  await a.wait(360);
  await a.click();
  await a.set({ hover: false, selected: true });
  await a.wait(720);

  // 2. Add a child from the selected node's toolbar.
  a.mark('add');
  await a.move('add-child');
  await a.wait(240);
  await a.click();
  await a.set({ editing: true, typing: '' });
  await a.wait(420);

  // 3. Type the child's title.
  a.mark('type');
  await a.type('typing', 'Press kit', { interval: 82 });
  await a.wait(480);

  // 4. Commit: the node and its edge arrive, then the save state settles.
  a.mark('commit');
  await a.key('enter');
  await a.set({ editing: false, added: true, saving: true });
  await a.wait(480);
  await a.set({ saving: false });
  await a.wait(1_900);

  // 5. Undo the addition so the loop returns to its opening frame.
  a.mark('undo');
  await a.key('cmd+z');
  await a.set({ added: false, selected: false, saving: false, typing: '' });
  await a.move('rest');
  await a.wait(900);
}

const rowTokens = {
  '--ss-row-title': '10.5px',
  '--ss-row-line': '14px',
  '--ss-row-meta': '9.5px',
  '--ss-row-gap': '1px',
} as CSSProperties;

const BRANCHES = [
  { id: 'audience', label: 'Audience', icon: 'target', color: 'var(--branch-1)', count: '3' },
  { id: 'narrative', label: 'Narrative', icon: 'book', color: 'var(--branch-2)', count: '5' },
  { id: 'channels', label: 'Channels', icon: 'link', color: 'var(--branch-3)', count: '4' },
  { id: 'timeline', label: 'Timeline', icon: 'clock', color: 'var(--branch-4)', count: '2' },
] as const;

function Node({
  id,
  label,
  icon,
  color,
  count,
  root,
  selected,
  hover,
}: {
  id: string;
  label: string;
  icon: string;
  color: string;
  count?: string;
  root?: boolean;
  selected?: boolean;
  hover?: boolean;
}) {
  return (
    <div
      className={`atlas-node${root ? ' atlas-node--root' : ''}`}
      data-node={id}
      data-target={id}
      data-selected={selected || undefined}
      data-hover={hover || undefined}
      style={{ '--node-accent': color } as CSSProperties}
    >
      {!root && <span className="atlas-node__rule" />}
      <span className="atlas-node__icon"><Icon name={icon} size={16} strokeWidth={1.7} /></span>
      <span className="atlas-node__body">
        <span className="atlas-node__title">{label}</span>
        {count && <span className="atlas-node__meta">{count} notes</span>}
      </span>
      <i className="atlas-node__handle" data-corner="tl" />
      <i className="atlas-node__handle" data-corner="tr" />
      <i className="atlas-node__handle" data-corner="bl" />
      <i className="atlas-node__handle" data-corner="br" />
    </div>
  );
}

function Sidebar({ s }: { s: DemoState }) {
  return (
    <div className="atlas-side">
      <div className="atlas-brand">
        <span className="atlas-brand__mark"><Icon name="branch" size={16} strokeWidth={1.8} /></span>
        <span>Atlas</span>
      </div>
      <div className="atlas-doc">
        <Text className="atlas-doc__title">Product launch</Text>
        <Text className="atlas-doc__meta">Local map</Text>
      </div>
      <div className="atlas-tabs">
        <span data-active>Outline</span>
        <span>Inspector</span>
      </div>
      <div className="atlas-outline" style={rowTokens}>
        <Row pad={8} selected={false} title={<Text>Product launch</Text>} lead={<Icon name="map" size={13} />} />
        {BRANCHES.map((branch) => (
          <Row
            key={branch.id}
            pad={8}
            selected={branch.id === 'channels' && s.selected}
            title={<Text>{branch.label}</Text>}
            meta={<Text tone={2}>{branch.count}</Text>}
            lead={<Icon name={branch.icon} size={13} />}
            className="atlas-outline__row"
            data-branch={branch.id}
          />
        ))}
      </div>
      <div className="atlas-side__card">
        <Icon name="save" size={14} />
        <div>
          <strong>Saved in this browser</strong>
          <span>No account. No upload.</span>
        </div>
      </div>
    </div>
  );
}

function Canvas({ s }: { s: DemoState }) {
  return (
    <div className="atlas-canvas" data-target="rest">
      <svg className="atlas-edges atlas-edges-wide" viewBox="0 0 668 394" aria-hidden>
        <path d="M196 212 C 246 212, 258 57, 306 57" style={{ stroke: 'var(--branch-1)' }} />
        <path d="M196 212 C 246 212, 258 151, 306 151" style={{ stroke: 'var(--branch-2)' }} />
        <path d="M196 212 C 246 212, 258 245, 306 245" style={{ stroke: 'var(--branch-3)' }} />
        <path d="M196 212 C 246 212, 258 339, 306 339" style={{ stroke: 'var(--branch-4)' }} />
        <path className="atlas-edge-new" data-added={s.added || undefined} d="M456 245 C 459 245, 460 252, 462 252" style={{ stroke: 'var(--branch-3)' }} />
      </svg>
      <svg className="atlas-edges atlas-edges-compact" viewBox="0 0 430 302" aria-hidden>
        <path d="M148 140 C 154 140, 154 38, 160 38" style={{ stroke: 'var(--branch-1)' }} />
        <path d="M148 140 C 154 140, 154 94, 160 94" style={{ stroke: 'var(--branch-2)' }} />
        <path d="M148 140 C 154 140, 154 150, 160 150" style={{ stroke: 'var(--branch-3)' }} />
        <path d="M148 140 C 154 140, 154 206, 160 206" style={{ stroke: 'var(--branch-4)' }} />
        <path className="atlas-edge-new" data-added={s.added || undefined} d="M260 150 C 264 150, 264 159, 268 159" style={{ stroke: 'var(--branch-3)' }} />
      </svg>

      <Node id="root" label="Product launch" icon="map" color="var(--accent)" root />
      {BRANCHES.map((branch) => (
        <Node
          key={branch.id}
          id={branch.id}
          label={branch.label}
          icon={branch.icon}
          color={branch.color}
          count={branch.count}
          selected={branch.id === 'channels' && s.selected}
          hover={branch.id === 'channels' && s.hover}
        />
      ))}

      <div className="atlas-new-node" data-added={s.added || undefined}>
        <Node id="press-kit" label="Press kit" icon="note" color="var(--branch-3)" />
      </div>

      <div className="atlas-node-toolbar" data-visible={s.selected || undefined}>
        <Button variant="ghost" size="small" icon={<Icon name="plus" size={12} />} data-target="add-child" aria-label="Add child" />
        <Button variant="ghost" size="small" icon={<Icon name="edit" size={12} />} aria-label="Rename" />
        <Button variant="ghost" size="small" icon={<Icon name="trash" size={12} />} aria-label="Delete" />
      </div>

      <div className="atlas-inline-editor" data-visible={s.editing || undefined} data-typing={s.editing || undefined}>
        <span>{s.typing || 'New idea'}</span>
        <i className="atlas-caret" />
      </div>
    </div>
  );
}

export function AtlasDemo({ theme = 'light' }: { theme?: 'light' | 'dark' }) {
  return (
    <Stage<DemoState>
      theme={theme}
      width={760}
      height={480}
      compact={{ below: 600, width: 358, height: 330 }}
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: 'rest', idle: 2_600 }}
      keys="bottom-right"
      accent={theme === 'dark' ? '#98a4ff' : '#4f46e5'}
      tokens={{
        '--ss-font': "'Inter', 'Segoe UI', system-ui, sans-serif",
        '--ss-radius-sm': '6px',
        '--ss-radius-md': '9px',
        '--ss-radius-lg': '12px',
        '--ss-radius-window': '14px',
        '--ss-control': '30px',
        '--ss-row': '26px',
      }}
      className="atlas-stage"
    >
      {(s, _rect, layout) => (
        <Window
          className="atlas-window"
          data-layout={layout}
          title="Product launch"
          sidebar={layout === 'wide' ? <Sidebar s={s} /> : undefined}
          sidebarWidth={172}
          toolbar={(
            <span className="atlas-actions">
              <span className="atlas-action"><Icon name="undo" size={13} /></span>
              <span className="atlas-action"><Icon name="redo" size={13} /></span>
              <span className="atlas-action"><Icon name="search" size={13} /></span>
              <Button variant="primary" size="small" icon={<Icon name="download" size={12} />}>{layout === 'wide' ? 'Export' : ''}</Button>
            </span>
          )}
        >
          <div className="atlas-body">
            <Canvas s={s} />
            <div className="atlas-status">
              <span className="atlas-status__saved"><i data-saving={s.saving || undefined} />All changes saved</span>
              <span>12 nodes · 4 branches</span>
              <span className="atlas-status__right">Tree layout · 100%</span>
            </div>
          </div>
        </Window>
      )}
    </Stage>
  );
}
