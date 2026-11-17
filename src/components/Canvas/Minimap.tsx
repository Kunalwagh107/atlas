import { memo, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import type { MeasuredNode } from '../../core/layout/measure';
import { branchColor } from '../../core/mindmap/palette';
import type { Point } from '../../core/mindmap/types';
import type { DerivedMap } from '../../state/derived';
import type { Viewport } from '../../state/types';
import { viewportWorldRect } from './viewport';

const WIDTH = 188;
const HEIGHT = 126;

export interface MinimapProps {
  derived: DerivedMap;
  viewport: Viewport;
  width: number;
  height: number;
  /** Live positions during a drag (the derived map intentionally stays stable). */
  positionsOverride?: Record<string, Point>;
  /** Live size during a corner resize. */
  sizesOverride?: Record<string, MeasuredNode>;
  onNavigate: (world: { x: number; y: number }) => void;
}

function MinimapImpl({ derived, viewport, width, height, positionsOverride, sizesOverride, onNavigate }: MinimapProps) {
  const { bounds, positions: basePositions, sizes: baseSizes, visibleIds, branchIndices, palette, doc } = derived;
  const sizes = sizesOverride ?? baseSizes;
  const view = viewportWorldRect(viewport, width, height, 0);
  const positions = useMemo(
    () => positionsOverride && Object.keys(positionsOverride).length
      ? { ...basePositions, ...positionsOverride }
      : basePositions,
    [basePositions, positionsOverride],
  );

  /** One <path> per branch colour instead of one <rect> per node: bounded DOM at 5k nodes. */
  const branchPaths = useMemo(() => {
    const byColor = new Map<string, string[]>();
    for (const id of visibleIds) {
      if (!doc || id === doc.rootId) continue;
      const p = positions[id];
      const s = sizes[id];
      if (!p || !s) continue;
      const color = branchColor(branchIndices[id] ?? -1, palette);
      const d = `M${(p.x - s.width / 2).toFixed(1)} ${(p.y - s.height / 2).toFixed(1)}h${s.width.toFixed(1)}v${Math.max(8, s.height).toFixed(1)}h${(-s.width).toFixed(1)}z`;
      const list = byColor.get(color);
      if (list) list.push(d);
      else byColor.set(color, [d]);
    }
    return [...byColor.entries()].map(([color, paths]) => ({ color, d: paths.join('') }));
  }, [visibleIds, positions, sizes, branchIndices, palette, doc]);

  const rootRect = useMemo(() => {
    if (!doc) return null;
    const p = positions[doc.rootId];
    const s = sizes[doc.rootId];
    if (!p || !s) return null;
    return { x: p.x - s.width / 2, y: p.y - s.height / 2, width: s.width, height: Math.max(8, s.height) };
  }, [doc, positions, sizes]);

  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      // The SVG uses preserveAspectRatio meet, so account for letterboxing.
      const scale = Math.min(rect.width / bounds.width, rect.height / bounds.height);
      const drawnW = bounds.width * scale;
      const drawnH = bounds.height * scale;
      const offsetX = (rect.width - drawnW) / 2;
      const offsetY = (rect.height - drawnH) / 2;
      const worldX = bounds.x + (event.clientX - rect.left - offsetX) / scale;
      const worldY = bounds.y + (event.clientY - rect.top - offsetY) / scale;
      if (Number.isFinite(worldX) && Number.isFinite(worldY)) onNavigate({ x: worldX, y: worldY });
    },
    [bounds, onNavigate],
  );

  if (!doc) return null;
  return (
    <div className="minimap" onPointerDown={(event) => event.stopPropagation()}>
      <div className="minimap__header">
        <span>Overview</span>
        <span className="minimap__count">{visibleIds.length}</span>
      </div>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={handleClick}
        role="img"
        aria-label="Map overview — click to navigate"
      >
        <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill={palette.canvasBg} />
        {branchPaths.map(({ color, d }) => (
          <path key={color} d={d} fill={color} opacity={0.62} />
        ))}
        {rootRect && (
          <rect
            x={rootRect.x}
            y={rootRect.y}
            width={rootRect.width}
            height={rootRect.height}
            rx={Math.min(8, rootRect.height / 3)}
            fill={palette.accent}
          />
        )}
        <rect
          x={view.x}
          y={view.y}
          width={view.width}
          height={view.height}
          fill={palette.accent}
          fillOpacity={0.08}
          stroke={palette.accent}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          rx={2}
        />
      </svg>
    </div>
  );
}

export const Minimap = memo(MinimapImpl);
