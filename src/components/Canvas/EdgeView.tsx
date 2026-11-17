import { memo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Palette } from '../../core/mindmap/palette';

export interface HierarchyEdgeProps {
  path: string;
  color: string;
  width: number;
  opacity: number;
  /** Theme-defined dash pattern (null for a solid line). */
  dash?: string | null;
}

function HierarchyEdgeImpl({ path, color, width, opacity, dash }: HierarchyEdgeProps) {
  return (
    <path
      className="map-edge"
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeDasharray={dash ?? undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      style={{ pointerEvents: 'none' }}
    />
  );
}

export const HierarchyEdge = memo(HierarchyEdgeImpl);

export interface RelationEdgeProps {
  id: string;
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  palette: Palette;
  selected: boolean;
  /** Focus Mode dimming for cross-links outside the focused branch. */
  dimmed?: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGPathElement>, id: string) => void;
  onContextMenu: (event: ReactMouseEvent<SVGGElement>, id: string) => void;
}

function RelationEdgeImpl({
  id,
  path,
  label,
  labelX,
  labelY,
  palette,
  selected,
  dimmed = false,
  onPointerDown,
  onContextMenu,
}: RelationEdgeProps) {
  const labelWidth = Math.max(20, label.length * 6.4 + 16);
  return (
    <g
      className={`map-relation ${selected ? 'is-selected' : ''}`}
      opacity={dimmed ? 0.18 : 1}
      onContextMenu={(e) => onContextMenu(e, id)}
    >
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={(e) => onPointerDown(e, id)}
      />
      <path
        className="map-relation__line"
        d={path}
        fill="none"
        stroke={selected ? palette.accent : palette.relation}
        strokeWidth={selected ? 2.4 : 1.8}
        strokeDasharray="6 5"
        strokeLinecap="round"
        markerEnd="url(#atlas-arrow)"
        opacity={0.9}
        style={{ pointerEvents: 'none' }}
      />
      {label && (
        <g style={{ pointerEvents: 'none' }} transform={`translate(${labelX - labelWidth / 2} ${labelY - 10})`}>
          <rect width={labelWidth} height={20} rx={10} fill={palette.nodeFill} stroke={palette.nodeBorder} strokeWidth={1} />
          <text
            x={labelWidth / 2}
            y={10.5}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fontWeight={600}
            fill={palette.nodeMuted}
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

export const RelationEdge = memo(RelationEdgeImpl);
