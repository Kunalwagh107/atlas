import { getVisibleNodes, updateNodes } from '../mindmap/operations';
import { mapSpacing } from '../mindmap/appearance';
import type { LayoutKind, MindMapDocument, MindNode, Point, Rect } from '../mindmap/types';
import type { MeasuredNode } from './measure';

export interface LayoutSpacing {
  gapPrimary: number;
  gapSecondary: number;
}

const FALLBACK_SIZE: MeasuredNode = {
  width: 160,
  height: 44,
  lines: [''],
  descriptionLine: '',
  lineHeight: 20,
  icon: '',
  fontSize: 14,
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  radius: 10,
  badges: [],
  image: undefined,
  imageCount: 0,
};

export interface ComputeLayoutOptions {
  /** Treat collapsed branches as expanded (used by complete-map export). */
  ignoreCollapsed?: boolean;
}

interface TreeData {
  /** Ordered visible children by id. */
  children: Record<string, string[]>;
  depth: Record<string, number>;
  visibleIds: string[];
  levelSize: number[];
  maxSecondaryExtent: number;
  countAtDepth: number[];
}

function buildTreeData(doc: MindMapDocument, sizes: Record<string, MeasuredNode>, vertical: boolean): TreeData {
  const byParent: Record<string, MindNode[]> = {};
  const visibleIds: string[] = [];
  for (const node of getVisibleNodes(doc)) {
    visibleIds.push(node.id);
    if (node.parentId) (byParent[node.parentId] ??= []).push(node);
  }
  const children: Record<string, string[]> = {};
  for (const [parentId, list] of Object.entries(byParent)) {
    list.sort((a, b) => {
      const ao = Number(a.metadata.order ?? a.createdAt);
      const bo = Number(b.metadata.order ?? b.createdAt);
      return ao - bo || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    });
    children[parentId] = list.map((n) => n.id);
  }
  for (const id of visibleIds) children[id] ??= [];

  const depth: Record<string, number> = { [doc.rootId]: 0 };
  const queue = [doc.rootId];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const childId of children[id] ?? []) {
      depth[childId] = (depth[id] ?? 0) + 1;
      queue.push(childId);
    }
  }

  const levelSize: number[] = [];
  const countAtDepth: number[] = [];
  let maxSecondaryExtent = 0;
  for (const id of visibleIds) {
    const d = depth[id] ?? 0;
    const size = sizes[id] ?? FALLBACK_SIZE;
    const primary = vertical ? size.height : size.width;
    const secondary = vertical ? size.width : size.height;
    levelSize[d] = Math.max(levelSize[d] ?? 0, primary);
    countAtDepth[d] = (countAtDepth[d] ?? 0) + 1;
    maxSecondaryExtent = Math.max(maxSecondaryExtent, secondary);
  }
  return { children, depth, visibleIds, levelSize, maxSecondaryExtent, countAtDepth };
}

function primaryOffsets(data: TreeData, gap: number): number[] {
  const offsets = [0];
  for (let d = 1; d < data.levelSize.length; d++) {
    const prev = data.levelSize[d - 1] ?? 0;
    const curr = data.levelSize[d] ?? 0;
    offsets[d] = offsets[d - 1] + (prev + curr) / 2 + gap;
  }
  return offsets;
}

interface SequentialResult {
  centers: Record<string, number>;
  min: number;
  max: number;
}

/** Sequential leaf slots along the secondary axis; parents are centred on their children. */
function assignSequential(
  data: TreeData,
  sizes: Record<string, MeasuredNode>,
  roots: string[],
  gap: number,
  vertical: boolean,
  allowed?: Set<string>,
): SequentialResult {
  const rowStep = data.maxSecondaryExtent + gap;
  const centers: Record<string, number> = {};
  let cursor = 0;
  let min = Infinity;
  let max = -Infinity;
  const visit = (id: string): number => {
    const kids = (data.children[id] ?? []).filter((c) => !allowed || allowed.has(c));
    const size = sizes[id] ?? FALLBACK_SIZE;
    const extent = vertical ? size.width : size.height;
    let center: number;
    if (kids.length === 0) {
      center = cursor + extent / 2;
      cursor += rowStep;
    } else {
      const childCenters = kids.map(visit);
      center = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }
    centers[id] = center;
    min = Math.min(min, center - extent / 2);
    max = Math.max(max, center + extent / 2);
    return center;
  };
  roots.forEach(visit);
  return { centers, min: Number.isFinite(min) ? min : 0, max: Math.max(max, 0) };
}

/** Guarantee a minimum gap between nodes sharing a column (defensive for odd data). */
function separateColumns(
  positions: Record<string, Point>,
  sizes: Record<string, MeasuredNode>,
  data: TreeData,
  columnOf: (id: string) => string,
  vertical: boolean,
  minGap: number,
): void {
  const columns: Record<string, string[]> = {};
  for (const id of data.visibleIds) (columns[columnOf(id)] ??= []).push(id);
  const axis: 'x' | 'y' = vertical ? 'x' : 'y';
  for (const list of Object.values(columns)) {
    list.sort((a, b) => positions[a][axis] - positions[b][axis]);
    let previousBottom = -Infinity;
    for (const id of list) {
      const size = sizes[id] ?? FALLBACK_SIZE;
      const extent = vertical ? size.width : size.height;
      const top = positions[id][axis] - extent / 2;
      if (top < previousBottom + minGap) positions[id][axis] += previousBottom + minGap - top;
      previousBottom = positions[id][axis] + extent / 2;
    }
  }
}

function subtreeLeafCount(data: TreeData, id: string, cache: Record<string, number>): number {
  if (cache[id] !== undefined) return cache[id];
  const kids = data.children[id] ?? [];
  const value = kids.length === 0 ? 1 : kids.reduce((sum, c) => sum + subtreeLeafCount(data, c, cache), 0);
  cache[id] = value;
  return value;
}

function collectSubtree(data: TreeData, roots: string[]): string[] {
  const out: string[] = [];
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const c of data.children[id] ?? []) stack.push(c);
  }
  return out;
}

function layoutTreeLike(
  doc: MindMapDocument,
  sizes: Record<string, MeasuredNode>,
  kind: 'tree' | 'horizontal' | 'vertical',
): Record<string, Point> {
  const vertical = kind === 'vertical';
  const spacing = mapSpacing(kind);
  const data = buildTreeData(doc, sizes, vertical);
  const offsets = primaryOffsets(data, spacing.gapPrimary);
  const positions: Record<string, Point> = {};
  const root = doc.rootId;

  if (kind === 'tree') {
    const rootChildren = data.children[root] ?? [];
    const leafCounts: Record<string, number> = {};
    for (const id of rootChildren) leafCounts[id] = subtreeLeafCount(data, id, leafCounts);
    // Greedy split by subtree weight, then restore source order within each half.
    const byWeight = [...rootChildren].sort((a, b) => leafCounts[b] - leafCounts[a]);
    const right: string[] = [];
    const left: string[] = [];
    let rightWeight = 0;
    let leftWeight = 0;
    for (const id of byWeight) {
      if (rightWeight <= leftWeight) {
        right.push(id);
        rightWeight += leafCounts[id];
      } else {
        left.push(id);
        leftWeight += leafCounts[id];
      }
    }
    const order = new Map(rootChildren.map((id, i) => [id, i]));
    right.sort((a, b) => order.get(a)! - order.get(b)!);
    left.sort((a, b) => order.get(a)! - order.get(b)!);

    const sideOf = new Map<string, 1 | -1>();
    const applySide = (ids: string[], sign: 1 | -1) => {
      if (ids.length === 0) return;
      const allowed = new Set(collectSubtree(data, ids));
      allowed.forEach((id) => sideOf.set(id, sign));
      const { centers, min, max } = assignSequential(data, sizes, ids, spacing.gapSecondary, false, allowed);
      const shift = -(min + max) / 2;
      for (const [id, center] of Object.entries(centers)) {
        positions[id] = { x: sign * offsets[data.depth[id] ?? 1], y: center + shift };
      }
    };
    applySide(right, 1);
    applySide(left, -1);
    positions[root] = { x: 0, y: 0 };
    separateColumns(positions, sizes, data, (id) => `${sideOf.get(id) ?? 1}:${data.depth[id]}`, false, 8);
  } else {
    const { centers, min, max } = assignSequential(data, sizes, [root], spacing.gapSecondary, vertical);
    const shift = -(min + max) / 2;
    for (const [id, center] of Object.entries(centers)) {
      const primary = offsets[data.depth[id] ?? 0] ?? 0;
      positions[id] = vertical
        ? { x: center + shift, y: primary }
        : { x: primary, y: center + shift };
    }
    separateColumns(positions, sizes, data, (id) => `${data.depth[id]}`, vertical, 8);
  }
  return positions;
}

function layoutRadial(doc: MindMapDocument, sizes: Record<string, MeasuredNode>): Record<string, Point> {
  const spacing = mapSpacing('radial');
  const data = buildTreeData(doc, sizes, false);
  const root = doc.rootId;
  const angles: Record<string, number> = {};
  const leafTotal = Math.max(1, data.visibleIds.filter((id) => (data.children[id] ?? []).length === 0).length);
  let leafIndex = 0;
  const assignAngle = (id: string): number => {
    const kids = data.children[id] ?? [];
    if (kids.length === 0) {
      const angle = -Math.PI / 2 + ((leafIndex + 0.5) / leafTotal) * Math.PI * 2;
      leafIndex++;
      angles[id] = angle;
      return angle;
    }
    const childAngles = kids.map(assignAngle);
    // Circular mean keeps branches from wrapping across the -π/π seam.
    let sx = 0;
    let sy = 0;
    for (const a of childAngles) {
      sx += Math.cos(a);
      sy += Math.sin(a);
    }
    angles[id] = Math.atan2(sy, sx);
    return angles[id];
  };
  assignAngle(root);

  const radii: number[] = [0];
  for (let d = 1; d < data.levelSize.length; d++) {
    const fromParent =
      radii[d - 1] + ((data.levelSize[d - 1] ?? 0) + (data.levelSize[d] ?? 0)) / 2 + spacing.gapPrimary;
    const count = data.countAtDepth[d] ?? 1;
    const tangentialExtent = Math.max(data.levelSize[d] ?? 160, data.maxSecondaryExtent);
    const circumferenceNeed = (count * (tangentialExtent + spacing.gapSecondary)) / (2 * Math.PI);
    radii[d] = Math.max(fromParent, circumferenceNeed);
  }

  const positions: Record<string, Point> = {};
  for (const id of data.visibleIds) {
    const r = radii[data.depth[id] ?? 0] ?? 0;
    const a = angles[id] ?? 0;
    positions[id] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  positions[root] = { x: 0, y: 0 };
  return positions;
}

/** Positions for *all* nodes. Hidden descendants follow their nearest visible ancestor. */
export function computeLayout(
  doc: MindMapDocument,
  sizes: Record<string, MeasuredNode>,
  layout: LayoutKind = doc.settings.layout,
  options: ComputeLayoutOptions = {},
): Record<string, Point> {
  // Exporting the complete map needs a layout where every branch is expanded.
  const workDoc: MindMapDocument = options.ignoreCollapsed
    ? {
        ...doc,
        nodes: Object.fromEntries(
          Object.entries(doc.nodes).map(([id, node]) => [id, { ...node, collapsed: false }]),
        ),
      }
    : doc;
  const positions =
    layout === 'radial'
      ? layoutRadial(workDoc, sizes)
      : layoutTreeLike(workDoc, sizes, layout === 'tree' ? 'tree' : layout === 'vertical' ? 'vertical' : 'horizontal');

  // Hidden nodes keep a sensible spot so expanding a branch never teleports content.
  const allChildren: Record<string, string[]> = {};
  for (const node of Object.values(workDoc.nodes)) {
    if (node.parentId) (allChildren[node.parentId] ??= []).push(node.id);
  }
  const placeHidden = (id: string, anchor: Point, offset: number): void => {
    for (const childId of allChildren[id] ?? []) {
      const next = positions[childId] ?? { x: anchor.x + 60 * offset, y: anchor.y + 44 * offset };
      positions[childId] = next;
      placeHidden(childId, next, offset + 1);
    }
  };
  placeHidden(workDoc.rootId, { x: 0, y: 0 }, 1);
  return positions;
}

export interface LayoutDocumentOptions extends ComputeLayoutOptions {
  /** Reset every node to automatic positioning (explicit "Reset to automatic layout"). */
  forceAll?: boolean;
}

/**
 * Applies computed positions. Manually positioned nodes are left exactly where the
 * user put them — only an explicit `forceAll` reset may move them.
 */
export function layoutDocument(
  doc: MindMapDocument,
  sizes: Record<string, MeasuredNode>,
  layout: LayoutKind = doc.settings.layout,
  options: LayoutDocumentOptions = {},
): MindMapDocument {
  const positions = computeLayout(doc, sizes, layout, options);
  const patches: Record<string, Partial<MindNode>> = {};
  for (const [id, position] of Object.entries(positions)) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (!options.forceAll && node.positionMode === 'manual') continue;
    patches[id] = { position, positionMode: 'auto' };
  }
  const next = updateNodes(doc, patches, false);
  return { ...next, settings: { ...next.settings, layout }, updatedAt: Date.now() };
}

export function computeBounds(
  positions: Record<string, Point>,
  sizes: Record<string, MeasuredNode>,
  ids: string[],
  padding = 80,
): Rect {
  if (ids.length === 0) return { x: -400, y: -300, width: 800, height: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    const s = sizes[id];
    if (!p || !s) continue;
    minX = Math.min(minX, p.x - s.width / 2);
    maxX = Math.max(maxX, p.x + s.width / 2);
    minY = Math.min(minY, p.y - s.height / 2);
    maxY = Math.max(maxY, p.y + s.height / 2);
  }
  if (!Number.isFinite(minX)) return { x: -400, y: -300, width: 800, height: 600 };
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}
