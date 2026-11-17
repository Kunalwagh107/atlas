import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  BADGE_CHIP_HEIGHT,
  BADGE_ROW_HEIGHT,
  IMAGE_STRIP,
  IMAGE_THUMB,
  type ContentBadge,
  type MapStyle,
} from '../../core/mindmap/appearance';
import { isLocalImageRef, isSafeImageSrc } from '../../core/mindmap/content';
import type { MeasuredNode } from '../../core/layout/measure';
import { resolveNodeColors, type Palette } from '../../core/mindmap/palette';
import type { MindNode, Point } from '../../core/mindmap/types';
import { Icon } from '../common/Icon';
import { iconForNode } from './viewport';

export type SearchMark = 'none' | 'match' | 'active';
export type ResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

export interface NodeViewProps {
  node: MindNode;
  /** Live centre: transient while dragging, otherwise the document position. */
  position: Point;
  size: MeasuredNode;
  palette: Palette;
  mapStyle: MapStyle;
  branchIdx: number;
  isRoot: boolean;
  selected: boolean;
  zoom: number;
  searchMark: SearchMark;
  linking: boolean;
  linkSource: boolean;
  childCount: number;
  badgeOnLeft: boolean;
  /** Focus Mode is active and this node lies outside the focused subtree. */
  dimmed: boolean;
  /** Local object URL for a blob-backed image, resolved by the canvas. */
  imageUrl?: string;
  showResizeHandles: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void;
  onDoubleClick: (event: ReactMouseEvent<SVGGElement>, id: string) => void;
  onContextMenu: (event: ReactMouseEvent<SVGGElement>, id: string) => void;
  onToggleCollapse: (id: string) => void;
  onKeyActivate: (event: ReactKeyboardEvent<SVGGElement>, id: string) => void;
  onResizeStart: (event: ReactPointerEvent<SVGRectElement>, id: string, corner: ResizeCorner) => void;
}

const CHIP_WIDTH = 54;
const CHIP_GAP = 4;
const CORNERS: { corner: ResizeCorner; sx: number; sy: number }[] = [
  { corner: 'nw', sx: 0, sy: 0 },
  { corner: 'ne', sx: 1, sy: 0 },
  { corner: 'se', sx: 1, sy: 1 },
  { corner: 'sw', sx: 0, sy: 1 },
];

function ContentChip({
  badge,
  x,
  y,
  fill,
  stroke,
  text,
  iconColor,
}: {
  badge: ContentBadge;
  x: number;
  y: number;
  fill: string;
  stroke: string;
  text: string;
  iconColor: string;
}) {
  const label = badge.label.length > 9 ? `${badge.label.slice(0, 8)}…` : badge.label;
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
      <rect width={CHIP_WIDTH} height={BADGE_CHIP_HEIGHT} rx={7.5} fill={fill} stroke={stroke} strokeWidth={0.8} />
      <Icon name={badge.icon} size={9} x={4} y={(BADGE_CHIP_HEIGHT - 9) / 2} color={iconColor} strokeWidth={2} />
      <text x={17} y={BADGE_CHIP_HEIGHT / 2} dominantBaseline="central" fontSize={9} fontWeight={600} fill={text}>
        {label}
      </text>
    </g>
  );
}

function NodeViewImpl({
  node,
  position,
  size,
  palette,
  mapStyle,
  branchIdx,
  isRoot,
  selected,
  zoom,
  searchMark,
  linking,
  linkSource,
  childCount,
  badgeOnLeft,
  dimmed,
  imageUrl,
  showResizeHandles,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
  onToggleCollapse,
  onKeyActivate,
  onResizeStart,
}: NodeViewProps) {
  const { width, height, lines, descriptionLine, lineHeight, icon, fontSize, fontFamily, radius, badges, image, imageCount } = size;
  const colors = resolveNodeColors(node, branchIdx, palette, isRoot);
  const x = -width / 2;
  const y = -height / 2;
  const glyph = icon || iconForNode(node, isRoot);
  const textX = x + 16 + (glyph ? 22 : 0);
  const firstLineY = y + 11 + lineHeight / 2;
  const descY = y + 11 + lines.length * lineHeight + 9;
  const badgeX = badgeOnLeft ? x - 12 : x + width + 12;
  const badgeLabel = node.collapsed ? `+${Math.min(childCount, 999)}` : '−';
  const badgeWidth = node.collapsed ? 24 + String(Math.min(childCount, 999)).length * 7 : 20;
  const chipsY = y + height - BADGE_ROW_HEIGHT + 2 - (image ? IMAGE_STRIP : 0);
  const imageY = y + height - IMAGE_STRIP + (IMAGE_STRIP - IMAGE_THUMB) / 2;
  const manual = node.positionMode === 'manual';
  const safeImage = image
    ? isLocalImageRef(image) ? imageUrl : isSafeImageSrc(image) ? image : undefined
    : undefined;
  const handleSize = Math.max(4, Math.min(22, 9 / zoom));

  return (
    <g
      className={[
        'map-node',
        selected ? 'is-selected' : '',
        searchMark === 'active' ? 'is-search-active' : searchMark === 'match' ? 'is-search-match' : '',
        linking ? 'is-link-target' : '',
        linkSource ? 'is-link-source' : '',
        isRoot ? 'is-root' : '',
        dimmed ? 'is-dimmed' : '',
      ].filter(Boolean).join(' ')}
      transform={`translate(${position.x} ${position.y})`}
      data-node-id={node.id}
    >
      {/* The interactive surface is its own group so handles and the collapse
          badge can be siblings — a nested role="button" is invalid ARIA. */}
      <g
        role="button"
        tabIndex={0}
        aria-label={`${node.title}${node.description ? ` — ${node.description}` : ''}${badges.length ? `, ${badges.map((b) => b.label).join(', ')}` : ''}`}
        onPointerDown={(event) => onPointerDown(event, node.id)}
        onDoubleClick={(event) => onDoubleClick(event, node.id)}
        onContextMenu={(event) => onContextMenu(event, node.id)}
        onKeyDown={(event) => onKeyActivate(event, node.id)}
      >
        <rect className="map-node__hit" x={x} y={y} width={width} height={height} rx={radius} fill="transparent" />
        <rect
          className="map-node__shadow"
          x={x + 1}
          y={y + 3}
          width={width}
          height={height}
          rx={radius}
          fill={palette.nodeShadow}
          opacity={mapStyle.shadowOpacity * (isRoot ? 1.6 : 1)}
        />
        <rect
          className="map-node__body"
          x={x}
          y={y}
          width={width}
          height={height}
          rx={radius}
          fill={colors.background}
          stroke={colors.border}
          strokeWidth={node.style.borderWidth}
        />
        {!colors.isCentral && (
          <rect x={x} y={y + 7} width={3.5} height={Math.max(4, height - 14)} rx={2} fill={colors.accent} opacity={0.95} />
        )}
        {glyph && (
          <Icon
            name={glyph}
            size={14}
            x={x + 12}
            y={firstLineY - 7}
            color={colors.isCentral ? colors.text : colors.accent}
            strokeWidth={2}
          />
        )}
        {lines.map((line, index) => (
          <text
            key={index}
            x={textX}
            y={firstLineY + index * lineHeight}
            fill={colors.text}
            fontFamily={fontFamily}
            fontSize={fontSize}
            fontWeight={node.style.fontWeight}
            dominantBaseline="central"
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {line}
          </text>
        ))}
        {descriptionLine && (
          <text
            x={textX}
            y={descY}
            fill={colors.mutedText}
            fontFamily={fontFamily}
            fontSize={Math.max(10, fontSize - 3)}
            fontWeight={450}
            dominantBaseline="central"
            opacity={colors.isCentral ? 0.85 : 0.9}
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {descriptionLine}
          </text>
        )}

        {safeImage && (
          <g className="map-node__image" style={{ pointerEvents: 'none' }}>
            <rect x={x + 10} y={imageY} width={IMAGE_THUMB} height={IMAGE_THUMB} rx={8} fill={palette.nodeFill} stroke={colors.border} strokeWidth={0.8} />
            <image
              data-image-id={node.content?.images?.[0]?.id}
              href={safeImage}
              x={x + 12}
              y={imageY + 2}
              width={IMAGE_THUMB - 4}
              height={IMAGE_THUMB - 4}
              preserveAspectRatio="xMidYMid meet"
            />
            {imageCount > 1 && (
              <text x={x + 10 + IMAGE_THUMB + 8} y={imageY + IMAGE_THUMB / 2} fontSize={10} fill={colors.mutedText} dominantBaseline="central">
                +{imageCount - 1} more
              </text>
            )}
          </g>
        )}

        {badges.length > 0 && (
          <g className="map-node__badges">
            {badges.map((badge, index) => (
              <ContentChip
                key={`${badge.icon}:${badge.label}:${index}`}
                badge={badge}
                x={x + 9 + index * (CHIP_WIDTH + CHIP_GAP)}
                y={chipsY}
                fill={colors.isCentral ? 'rgba(255,255,255,0.16)' : palette.nodeFill}
                stroke={colors.border}
                text={colors.mutedText}
                iconColor={colors.accent}
              />
            ))}
          </g>
        )}

        {manual && (
          <g data-export-ignore="true" transform={`translate(${x + width - 17} ${y + 6})`} style={{ pointerEvents: 'none' }}>
            <title>Manually positioned — Re-arrange puts it back into the layout</title>
            <circle r={7} fill={palette.nodeFill} stroke={colors.accent} strokeWidth={1} opacity={0.95} />
            <Icon name="pin" size={9} x={-4.5} y={-4.5} color={colors.accent} strokeWidth={2} />
          </g>
        )}

        {selected && (
          <rect
            data-export-ignore="true"
            className="map-node__selection"
            x={x - 5}
            y={y - 5}
            width={width + 10}
            height={height + 10}
            rx={radius + 5}
            fill="none"
            stroke={palette.selection}
            strokeWidth={2 / zoom}
            opacity={0.95}
          />
        )}
        {searchMark === 'active' && (
          <rect
            data-export-ignore="true"
            x={x - 8}
            y={y - 8}
            width={width + 16}
            height={height + 16}
            rx={radius + 8}
            fill="none"
            stroke={palette.theme === 'dark' ? '#e7a94f' : '#d97706'}
            strokeWidth={3}
            opacity={0.9}
          />
        )}
        {linkSource && (
          <rect
            data-export-ignore="true"
            x={x - 7}
            y={y - 7}
            width={width + 14}
            height={height + 14}
            rx={radius + 7}
            fill="none"
            stroke={palette.accent}
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}
      </g>

      {childCount > 0 && (
        <g
          className={`map-node__collapse ${node.collapsed ? 'is-collapsed' : 'is-optional'}`}
          transform={`translate(${badgeOnLeft ? badgeX - badgeWidth : badgeX} ${-9})`}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(node.id);
          }}
          role="button"
          tabIndex={0}
          aria-label={node.collapsed ? `Expand ${childCount} hidden nodes` : 'Collapse branch'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onToggleCollapse(node.id);
            }
          }}
        >
          <rect width={badgeWidth} height={18} rx={9} fill={palette.nodeFill} stroke={colors.accent} strokeWidth={1.2} />
          <text
            x={badgeWidth / 2}
            y={9.5}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fontWeight={700}
            fill={colors.accent}
            style={{ userSelect: 'none' }}
          >
            {badgeLabel}
          </text>
        </g>
      )}

      {showResizeHandles && CORNERS.map(({ corner, sx, sy }) => (
        <rect
          key={corner}
          data-export-ignore="true"
          data-resize-corner={corner}
          className={`map-node__resize map-node__resize--${corner}`}
          x={x + sx * width - handleSize / 2}
          y={y + sy * height - handleSize / 2}
          width={handleSize}
          height={handleSize}
          rx={Math.min(2, handleSize / 3)}
          fill={palette.nodeFill}
          stroke={palette.selection}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          aria-hidden="true"
          onPointerDown={(event) => onResizeStart(event, node.id, corner)}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        >
          <title>Drag to resize this node</title>
        </rect>
      ))}
    </g>
  );
}

export const NodeView = memo(NodeViewImpl);
