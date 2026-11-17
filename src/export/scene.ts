import { hierarchyPath, relationPath } from '../components/Canvas/viewport';
import { computeBounds } from '../core/layout';
import type { MeasuredNode } from '../core/layout/measure';
import {
  BADGE_CHIP_HEIGHT,
  BADGE_ROW_HEIGHT,
  IMAGE_STRIP,
  IMAGE_THUMB,
  effectiveEdgeWidth,
  type MapStyle,
} from '../core/mindmap/appearance';
import { isLocalImageRef, isSafeImageSrc } from '../core/mindmap/content';
import { ICON_SVG_PATHS } from '../core/mindmap/icons';
import { branchColor, branchIndexOf, resolveNodeColors, type Palette } from '../core/mindmap/palette';
import type { MindMapDocument, Point, Rect } from '../core/mindmap/types';

/** One BFS pass instead of a full parent/sibling walk per node. */
function buildBranchIndices(doc: MindMapDocument): Record<string, number> {
  const byParent: Record<string, string[]> = {};
  for (const node of Object.values(doc.nodes)) {
    if (node.parentId) (byParent[node.parentId] ??= []).push(node.id);
  }
  const indices: Record<string, number> = { [doc.rootId]: -1 };
  (byParent[doc.rootId] ?? []).forEach((child, index) => {
    indices[child] = index % 8;
    const stack = [child];
    while (stack.length) {
      const id = stack.pop()!;
      for (const grandChild of byParent[id] ?? []) {
        indices[grandChild] = index % 8;
        stack.push(grandChild);
      }
    }
  });
  return indices;
}

/**
 * Standalone SVG scene renderer. Unlike cloning the live canvas (which is
 * viewport-culled), this draws every requested node — so "complete map" exports
 * include collapsed branches, and PNG/PDF output is not limited to what is on screen.
 */

export interface ExportSceneSpec {
  doc: MindMapDocument;
  ids: string[];
  positions: Record<string, Point>;
  sizes: Record<string, MeasuredNode>;
  palette: Palette;
  mapStyle: MapStyle;
  /** imageId → data URL resolved from local blobs for standalone exports. */
  imageSources?: Record<string, string>;
  padding?: number;
  includeGrid?: boolean;
  /** Restrict output to a sub-rectangle of the generated scene (PDF tiling). */
  clip?: Rect;
  /**
   * Force the world rectangle. Animation frames must share one camera, so an
   * overlay containing only the active node reuses the full scene's bounds.
   */
  bounds?: Rect;
  /** Multiply the intrinsic pixel size without changing the world viewBox. */
  pixelScale?: number;
  /** Per-node opacity, used by presentation GIF frames to dim the rest of the map. */
  opacityOf?: (id: string) => number;
  /** Omit the background rect so the scene can be layered over another image. */
  transparent?: boolean;
}

export interface RenderedScene {
  markup: string;
  width: number;
  height: number;
  bounds: Rect;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Attribute values are always escaped, even when they come from our own palette. */
function attr(value: string): string {
  return esc(value);
}

/**
 * Defence in depth: a colour from an imported file may only be a plain CSS colour.
 * Anything else (markup, url(), expression(), CSS escapes) falls back to a safe value,
 * so an exported .svg can never contain attacker-controlled tags or attributes.
 */
const SAFE_COLOR = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.%,\s-]+\)|hsla?\(\s*[\d.%,\s-]+\)|transparent|none)$/;

export function safeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return SAFE_COLOR.test(trimmed) && trimmed.length <= 64 ? trimmed : fallback;
}

/** An imported data URL must be a bitmap image before it reaches an <image href>. */
function safeImageHref(value: string): string | null {
  return isSafeImageSrc(value) ? attr(value) : null;
}

function n(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : '0';
}

function clampOpacity(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function glyph(name: string, x: number, y: number, color: string, size = 14): string {
  const paths = ICON_SVG_PATHS[name];
  if (!paths) return '';
  const scale = size / 24;
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${scale.toFixed(4)})" fill="none" stroke="${attr(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

function nodeMarkup(spec: ExportSceneSpec, id: string, branchIndices: Record<string, number>): string {
  const { doc, positions, sizes, palette, mapStyle } = spec;
  const node = doc.nodes[id];
  const size = sizes[id];
  const position = positions[id];
  if (!node || !size || !position) return '';
  const isRoot = id === doc.rootId;
  const opacity = spec.opacityOf ? clampOpacity(spec.opacityOf(id)) : 1;
  const resolved = resolveNodeColors(node, branchIndices[id] ?? branchIndexOf(node, doc), palette, isRoot);
  // Every colour reaching an attribute is both whitelisted and escaped.
  const colors = {
    background: safeColor(resolved.background, palette.nodeFill),
    text: safeColor(resolved.text, palette.nodeText),
    mutedText: safeColor(resolved.mutedText, palette.nodeMuted),
    border: safeColor(resolved.border, palette.nodeBorder),
    accent: safeColor(resolved.accent, palette.accent),
    isCentral: resolved.isCentral,
  };
  const { width, height, lines, descriptionLine, lineHeight, icon, fontSize, fontFamily, radius, badges, image, imageCount } = size;
  const x = position.x - width / 2;
  const y = position.y - height / 2;
  const textX = x + 16 + (icon ? 22 : 0);
  const firstLineY = y + 11 + lineHeight / 2;
  const descY = y + 11 + lines.length * lineHeight + 9;
  const chipsY = y + height - BADGE_ROW_HEIGHT + 2 - (image ? IMAGE_STRIP : 0);
  const imageY = y + height - IMAGE_STRIP + (IMAGE_STRIP - IMAGE_THUMB) / 2;
  const parts: string[] = [`<g data-node-id="${attr(id)}"${opacity !== 1 ? ` opacity="${n(opacity)}"` : ''}>`];

  parts.push(`<rect x="${n(x + 1)}" y="${n(y + 3)}" width="${n(width)}" height="${n(height)}" rx="${n(radius)}" fill="${attr(palette.nodeShadow)}" opacity="${n(mapStyle.shadowOpacity * (isRoot ? 1.6 : 1))}"/>`);
  parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${n(radius)}" fill="${attr(colors.background)}" stroke="${attr(colors.border)}" stroke-width="${n(node.style.borderWidth)}"/>`);
  if (!colors.isCentral) {
    parts.push(`<rect x="${n(x)}" y="${n(y + 7)}" width="3.5" height="${n(Math.max(4, height - 14))}" rx="2" fill="${attr(colors.accent)}" opacity="0.95"/>`);
  }
  if (icon) parts.push(glyph(icon, x + 12, firstLineY - 7, colors.isCentral ? colors.text : colors.accent));
  lines.forEach((line, index) => {
    parts.push(`<text x="${n(textX)}" y="${n(firstLineY + index * lineHeight)}" fill="${attr(colors.text)}" font-family="${attr(fontFamily)}" font-size="${n(fontSize)}" font-weight="${n(node.style.fontWeight)}" dominant-baseline="central">${esc(line)}</text>`);
  });
  if (descriptionLine) {
    parts.push(`<text x="${n(textX)}" y="${n(descY)}" fill="${attr(colors.mutedText)}" font-family="${attr(fontFamily)}" font-size="${n(Math.max(10, fontSize - 3))}" font-weight="450" dominant-baseline="central" opacity="0.9">${esc(descriptionLine)}</text>`);
  }

  const resolvedImage = image && isLocalImageRef(image)
    ? spec.imageSources?.[image.slice('atlas-blob:'.length)] ?? ''
    : image ?? '';
  const imageHref = resolvedImage ? safeImageHref(resolvedImage) : null;
  if (imageHref) {
    parts.push(`<rect x="${n(x + 10)}" y="${n(imageY)}" width="${IMAGE_THUMB}" height="${IMAGE_THUMB}" rx="8" fill="${attr(safeColor(palette.nodeFill, '#ffffff'))}" stroke="${attr(colors.border)}" stroke-width="0.8"/>`);
    parts.push(`<image href="${imageHref}" xlink:href="${imageHref}" x="${n(x + 12)}" y="${n(imageY + 2)}" width="${IMAGE_THUMB - 4}" height="${IMAGE_THUMB - 4}" preserveAspectRatio="xMidYMid meet"/>`);
    if (imageCount > 1) {
      parts.push(`<text x="${n(x + 10 + IMAGE_THUMB + 8)}" y="${n(imageY + IMAGE_THUMB / 2)}" font-size="10" fill="${attr(colors.mutedText)}" dominant-baseline="central">+${imageCount - 1} more</text>`);
    }
  }

  if (badges.length) {
    const chipFill = safeColor(colors.isCentral ? 'rgba(255,255,255,0.16)' : palette.nodeFill, '#ffffff');
    badges.forEach((badge, index) => {
      const chipX = x + 9 + index * 58;
      const label = badge.label.length > 9 ? `${badge.label.slice(0, 8)}…` : badge.label;
      parts.push(`<rect x="${n(chipX)}" y="${n(chipsY)}" width="54" height="${BADGE_CHIP_HEIGHT}" rx="7.5" fill="${attr(chipFill)}" stroke="${attr(colors.border)}" stroke-width="0.8"/>`);
      parts.push(glyph(badge.icon, chipX + 4, chipsY + (BADGE_CHIP_HEIGHT - 9) / 2, colors.accent, 9));
      parts.push(`<text x="${n(chipX + 17)}" y="${n(chipsY + BADGE_CHIP_HEIGHT / 2)}" font-size="9" font-weight="600" fill="${attr(colors.mutedText)}" dominant-baseline="central">${esc(label)}</text>`);
    });
  }

  // Collapsed branches are shown expanded in complete exports, so no +/- chrome is drawn.
  parts.push('</g>');
  return parts.join('');
}

export function renderExportScene(spec: ExportSceneSpec): RenderedScene {
  const { doc, positions, sizes, palette, mapStyle, ids, includeGrid } = spec;
  const padding = spec.padding ?? 64;
  const bounds = spec.bounds ?? computeBounds(positions, sizes, ids, padding);
  // `clip` is expressed in page coordinates (0..bounds.width); translate it back
  // into world space for the scene group's transform.
  const clip = spec.clip;
  const viewport: Rect = clip
    ? {
        x: bounds.x + clip.x,
        y: bounds.y + clip.y,
        width: clip.width,
        height: clip.height,
      }
    : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  const pixelScale = Math.max(0.05, Math.min(spec.pixelScale ?? 1, 4));
  const width = Math.max(1, Math.ceil(viewport.width * pixelScale));
  const height = Math.max(1, Math.ceil(viewport.height * pixelScale));
  const idSet = new Set(ids);
  const branchIndices = buildBranchIndices(doc);
  const parts: string[] = [];

  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="${n(viewport.x)} ${n(viewport.y)} ${n(viewport.width)} ${n(viewport.height)}">`,
  );
  parts.push(`<title>${esc(doc.title)}</title>`);
  // The font stack is an internal constant; strip any CSS control characters anyway.
  parts.push(`<style>svg { font-family: ${esc(mapStyle.fontFamily.replace(/[{};<>]/g, ''))}; }</style>`);
  parts.push('<defs>');
  parts.push(`<marker id="atlas-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L9,4.5 L0,9 z" fill="${attr(palette.relation)}"/></marker>`);
  if (includeGrid) {
    parts.push(`<pattern id="atlas-export-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${attr(palette.gridDot)}"/></pattern>`);
  }
  parts.push('</defs>');
  if (!spec.transparent) {
    parts.push(`<rect x="${n(viewport.x)}" y="${n(viewport.y)}" width="${n(viewport.width)}" height="${n(viewport.height)}" fill="${attr(palette.canvasBg)}"/>`);
    if (includeGrid) parts.push(`<rect x="${n(viewport.x)}" y="${n(viewport.y)}" width="${n(viewport.width)}" height="${n(viewport.height)}" fill="url(#atlas-export-grid)"/>`);
  }

  // The viewBox already carries the world offset, so the scene group is untransformed.
  parts.push('<g>');

  const depth: Record<string, number> = {};
  for (const id of ids) {
    let cursor: string | null = id;
    let level = 0;
    let guard = 0;
    while (cursor && guard++ < 1000) {
      cursor = doc.nodes[cursor]?.parentId ?? null;
      level++;
    }
    depth[id] = Math.max(1, level - 1);
  }

  // Hierarchy connectors.
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node?.parentId || !idSet.has(node.parentId)) continue;
    const parent = doc.nodes[node.parentId];
    const parentSize = sizes[node.parentId];
    const childSize = sizes[id];
    const parentPosition = positions[node.parentId];
    const childPosition = positions[id];
    if (!parent || !parentSize || !childSize || !parentPosition || !childPosition) continue;
    const geometry = hierarchyPath(parentPosition, parentSize, childPosition, childSize);
    const color = safeColor(branchColor(branchIndices[id] ?? branchIndexOf(node, doc), palette), palette.accent);
    const widthPx = effectiveEdgeWidth(depth[id] ?? 1);
    const dash = mapStyle.edgeDash ? ` stroke-dasharray="${attr(mapStyle.edgeDash)}"` : '';
    const opacity = 0.82 * (spec.opacityOf ? clampOpacity(spec.opacityOf(id)) : 1);
    parts.push(`<path d="${attr(geometry.path)}" fill="none" stroke="${attr(color)}" stroke-width="${n(widthPx)}" stroke-linecap="round" stroke-linejoin="round" opacity="${n(opacity)}"${dash}/>`);
  }

  // Cross-connections.
  for (const edge of Object.values(doc.edges)) {
    if (edge.kind !== 'relation' || !idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    const fromSize = sizes[edge.source];
    const toSize = sizes[edge.target];
    const fromPosition = positions[edge.source];
    const toPosition = positions[edge.target];
    if (!fromSize || !toSize || !fromPosition || !toPosition) continue;
    const geometry = relationPath(fromPosition, fromSize, toPosition, toSize);
    parts.push(`<path d="${attr(geometry.path)}" fill="none" stroke="${attr(palette.relation)}" stroke-width="1.8" stroke-dasharray="6 5" stroke-linecap="round" marker-end="url(#atlas-arrow)" opacity="0.9"/>`);
    if (edge.label) {
      const labelWidth = Math.max(20, edge.label.length * 6.4 + 16);
      parts.push(`<g transform="translate(${n(geometry.midpoint.x - labelWidth / 2)} ${n(geometry.midpoint.y - 10)})"><rect width="${n(labelWidth)}" height="20" rx="10" fill="${attr(palette.nodeFill)}" stroke="${attr(palette.nodeBorder)}"/><text x="${n(labelWidth / 2)}" y="10.5" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="600" fill="${attr(palette.nodeMuted)}">${esc(edge.label)}</text></g>`);
    }
  }

  for (const id of ids) parts.push(nodeMarkup(spec, id, branchIndices));
  parts.push('</g></svg>');

  return { markup: parts.join('\n'), width, height, bounds };
}
