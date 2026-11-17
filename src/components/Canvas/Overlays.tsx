import type { Point } from '../../core/mindmap/types';
import { actions } from '../../state/actions';
import type { ConflictState } from '../../state/types';
import { Icon } from '../common/Icon';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Marquee rectangle drawn in screen space so its border stays crisp at any zoom. */
export function LassoOverlay({ rect, right = false }: { rect: ScreenRect | null; right?: boolean }) {
  if (!rect) return null;
  return (
    <div
      className={`lasso-rect ${right ? 'lasso-rect--right' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      aria-hidden="true"
    />
  );
}

/**
 * Another tab holds a newer revision. Writes are blocked until this is resolved,
 * so the banner has no dismiss button: every option is explicit and recoverable.
 */
export function ConflictBanner({
  conflict,
  onCopy,
  onReload,
  onOverwrite,
}: {
  conflict: ConflictState;
  onCopy: () => void;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div className="conflict-banner" role="alert">
      <Icon name="alert" size={16} />
      <div className="conflict-banner__text">
        <strong>This map changed in another tab</strong>
        <span>
          {conflict.dirty
            ? 'Your unsaved edits are safe — keep them as a copy, reload the other version, or overwrite it.'
            : 'Reload to see the newer version.'}
        </span>
      </div>
      <div className="conflict-banner__actions">
        {conflict.dirty && (
          <button type="button" className="btn btn-sm btn-primary" onClick={onCopy}>Save my copy</button>
        )}
        <button type="button" className="btn btn-sm" onClick={onReload}>Reload theirs</button>
        {conflict.dirty && (
          <button type="button" className="btn btn-sm btn-danger" onClick={onOverwrite}>Overwrite</button>
        )}
      </div>
    </div>
  );
}

export function FocusBanner({ title, onExit }: { title: string; onExit: () => void }) {
  return (
    <div className="focus-banner" role="status">
      <Icon name="focus" size={15} />
      <span>Focused on <strong title={title}>{title}</strong></span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onExit}>
        Exit focus <span className="kbd">Esc</span>
      </button>
    </div>
  );
}

export interface PresentationChromeProps {
  index: number;
  total: number;
  title: string;
  description: string;
  playing: boolean;
  speedMs: number;
  onTogglePlay: () => void;
  onSpeedChange: (speedMs: number) => void;
  onExportGif: () => void;
  onExit: () => void;
}

export function PresentationChrome({
  index, total, title, description, playing, speedMs,
  onTogglePlay, onSpeedChange, onExportGif, onExit,
}: PresentationChromeProps) {
  return (
    <div className="presentation-chrome" role="region" aria-label="Presentation controls">
      <div className="presentation-chrome__head">
        <span className="presentation-chrome__badge"><Icon name="presentation" size={14} /> Presenting</span>
        <span className="presentation-chrome__count">{index + 1} / {total}</span>
        <div className="spacer" />
        <select
          className="input input-sm presentation-chrome__speed"
          aria-label="Playback speed"
          value={speedMs}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
        >
          <option value={750}>0.75s / step</option>
          <option value={1500}>1.5s / step</option>
          <option value={3000}>3s / step</option>
        </select>
        <button type="button" className="btn btn-sm" onClick={onExportGif}>
          <Icon name="download" size={14} /> GIF
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onExit}>
          Exit <span className="kbd">Esc</span>
        </button>
      </div>
      <div className="presentation-chrome__body">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="presentation-chrome__foot">
        <button type="button" className="btn btn-sm" disabled={index <= 0} onClick={() => actions.presentationStep(-1)} aria-label="Previous step">
          <Icon name="skip-back" size={14} /> Previous
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          aria-label={playing ? 'Pause presentation' : 'Play presentation'}
          aria-pressed={playing}
          disabled={total <= 1}
          onClick={onTogglePlay}
        >
          <Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : 'Play'}
        </button>
        <div className="presentation-progress" aria-hidden="true">
          <span style={{ width: `${total ? ((index + 1) / total) * 100 : 0}%` }} />
        </div>
        <button type="button" className="btn btn-sm btn-primary" disabled={index >= total - 1} onClick={() => actions.presentationStep(1)}>
          Next <Icon name="skip-forward" size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Dashed alignment guides while dragging. Rendered inside the transformed scene
 * group; non-scaling strokes keep the line 1px regardless of zoom.
 */
export function AlignmentGuides({
  positions,
  ids,
  dragIds,
}: {
  positions: Record<string, Point>;
  ids: string[];
  dragIds: string[];
}) {
  if (!dragIds.length) return null;
  const primary = positions[dragIds[0]];
  if (!primary) return null;
  const threshold = 6;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    if (dragIds.includes(id)) continue;
    if (Math.abs(p.x - primary.x) < threshold && guideX === null) guideX = p.x;
    if (Math.abs(p.y - primary.y) < threshold && guideY === null) guideY = p.y;
  }
  if (guideX === null && guideY === null) return null;
  const padX = 220;
  const padY = 160;
  return (
    <g className="alignment-guides" data-export-ignore="true" style={{ pointerEvents: 'none' }}>
      {guideX !== null && (
        <line
          x1={guideX} x2={guideX} y1={minY - padY} y2={maxY + padY}
          stroke="#e7a94f" strokeWidth={1} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" opacity={0.9}
        />
      )}
      {guideY !== null && (
        <line
          y1={guideY} y2={guideY} x1={minX - padX} x2={maxX + padX}
          stroke="#e7a94f" strokeWidth={1} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" opacity={0.9}
        />
      )}
    </g>
  );
}
