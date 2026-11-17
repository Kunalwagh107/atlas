import { iconForNode } from '../mindmap/icons';
import {
  BADGE_ROW_HEIGHT,
  IMAGE_STRIP,
  badgeFingerprint,
  effectiveFontSize,
  effectiveRadius,
  nodeBadges,
  mapFontFamily,
  type ContentBadge,
} from '../mindmap/appearance';
import { isSafeImageSrc } from '../mindmap/content';
import type { MindNode, Size } from '../mindmap/types';

export interface MeasuredNode extends Size {
  lines: string[];
  descriptionLine: string;
  lineHeight: number;
  icon: string;
  /** Resolved text size used by both renderer and measurer. */
  fontSize: number;
  fontFamily: string;
  radius: number;
  badges: ContentBadge[];
  /** First attached image, drawn as a thumbnail on the node and in exports. */
  image?: string;
  imageCount: number;
}

const MAX_TEXT_WIDTH = 236;
const MIN_WIDTH = 116;
const ICON_SPACE = 24;
const HORIZONTAL_PADDING = 34;

let context: CanvasRenderingContext2D | null = null;
const textWidthCache = new Map<string, number>();
const nodeCache = new Map<string, MeasuredNode>();

/**
 * Evict the oldest entries once a cache grows past `max`, keeping it at `keep`.
 * A full `clear()` turned every 6000th new title into a 40 ms cold re-measure of
 * the whole map; Map preserves insertion order, so dropping the front is a cheap
 * approximation of LRU.
 */
function trimCache<K, V>(cache: Map<K, V>, max: number, keep: number): void {
  if (cache.size <= max) return;
  const overflow = cache.size - keep;
  let removed = 0;
  for (const key of cache.keys()) {
    if (removed++ >= overflow) break;
    cache.delete(key);
  }
}

function measureText(text: string, fontSize: number, fontWeight: number, fontFamily: string): number {
  const key = `${fontFamily}|${fontWeight}|${fontSize}|${text}`;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;
  if (!context) {
    context = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  let width: number;
  if (context) {
    context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    width = context.measureText(text).width;
  } else {
    // Deterministic fallback for benchmarks and non-DOM test environments.
    width = text.length * fontSize * 0.55;
  }
  trimCache(textWidthCache, 8000, 6000);
  textWidthCache.set(key, width);
  return width;
}

function truncate(text: string, fontSize: number, fontWeight: number, maxWidth: number, fontFamily: string): string {
  if (measureText(text, fontSize, fontWeight, fontFamily) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(`${text.slice(0, mid)}…`, fontSize, fontWeight, fontFamily) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function wrap(text: string, fontSize: number, fontWeight: number, maxWidth: number, fontFamily: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return ['Untitled'];
  if (measureText(clean, fontSize, fontWeight, fontFamily) <= maxWidth) return [clean];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, fontSize, fontWeight, fontFamily) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // Only two lines are drawn: truncate everything that remains into the second one.
      lines.push(truncate(words.slice(i).join(' '), fontSize, fontWeight, maxWidth, fontFamily));
      return lines;
    }
  }
  if (current) lines.push(truncate(current, fontSize, fontWeight, maxWidth, fontFamily));
  if (lines.length > 2) lines.length = 2;
  return lines.length ? lines : ['Untitled'];
}

export function measureNode(
  node: MindNode,
  showDescriptions: boolean,
  isRoot: boolean,
): MeasuredNode {
  const fontSize = effectiveFontSize(node, isRoot);
  const fontWeight = node.style.fontWeight;
  const fontFamily = mapFontFamily();
  const radius = effectiveRadius(node);
  const icon = iconForNode(node, isRoot);
  const badges = nodeBadges(node.content);
  const images = (node.content?.images ?? []).filter((image) => isSafeImageSrc(image.src));
  const image = images[0]?.src;
  const imageCount = images.length;
  const desc = showDescriptions ? node.description.replace(/\s+/g, ' ').trim() : '';
  const overrideWidth = node.style.width;
  const overrideHeight = node.style.height;
  const key = [
    node.title, desc, fontSize, fontWeight, fontFamily, radius, node.style.preset, icon,
    overrideWidth ?? 0, overrideHeight ?? 0, isRoot ? 1 : 0, badgeFingerprint(badges),
    image ?? '', imageCount,
  ].join('|');
  const cached = nodeCache.get(key);
  if (cached) return cached;

  const availableTextWidth = Math.max(
    72,
    (overrideWidth ? overrideWidth - HORIZONTAL_PADDING : MAX_TEXT_WIDTH) - (icon ? ICON_SPACE : 0),
  );
  const lines = wrap(node.title, fontSize, fontWeight, availableTextWidth, fontFamily);
  const descSize = Math.max(10, fontSize - 3);
  const descriptionLine = desc ? truncate(desc, descSize, 450, availableTextWidth, fontFamily) : '';
  const lineHeight = Math.round(fontSize * 1.42);
  const widest = Math.max(...lines.map((l) => measureText(l, fontSize, fontWeight, fontFamily)));
  const descWidth = descriptionLine ? measureText(descriptionLine, descSize, 450, fontFamily) : 0;
  const contentWidth = Math.max(widest, descWidth);
  // Badge chips need a minimum width so they never spill outside the body.
  const badgeWidth = badges.length ? badges.length * 58 + 12 : 0;
  const width = overrideWidth ?? Math.round(
    Math.min(270, Math.max(MIN_WIDTH, Math.max(contentWidth, badgeWidth, image ? IMAGE_STRIP : 0) + HORIZONTAL_PADDING + (icon ? ICON_SPACE : 0))),
  );
  const naturalHeight = Math.round(
    20 + lines.length * lineHeight + (descriptionLine ? 19 : 0) + (isRoot ? 6 : 0) +
    (badges.length ? BADGE_ROW_HEIGHT : 0) + (image ? IMAGE_STRIP : 0),
  );
  // An explicit height (corner-drag resize) can grow a node but must never clip text.
  const height = overrideHeight ? Math.max(naturalHeight, Math.round(overrideHeight)) : naturalHeight;
  const result: MeasuredNode = {
    width, height, lines, descriptionLine, lineHeight, icon, fontSize, fontFamily, radius, badges,
    image, imageCount,
  };
  trimCache(nodeCache, 6000, 4000);
  nodeCache.set(key, result);
  return result;
}

export function measureAll(
  nodes: MindNode[],
  showDescriptions: boolean,
  rootId: string,
): Record<string, MeasuredNode> {
  const result: Record<string, MeasuredNode> = {};
  for (const node of nodes) result[node.id] = measureNode(node, showDescriptions, node.id === rootId);
  return result;
}

export function clearMeasureCache(): void {
  nodeCache.clear();
  textWidthCache.clear();
}
