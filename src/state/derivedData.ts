import { computeBounds } from '../core/layout';
import { measureAll, measureNode, type MeasuredNode } from '../core/layout/measure';
import { MAP_STYLE, type MapStyle } from '../core/mindmap/appearance';
import { getPalette, type Palette } from '../core/mindmap/palette';
import type { MindMapDocument, MindNode, Point, Rect, ThemeKind } from '../core/mindmap/types';

export interface DerivedStats {
  nodes: number;
  edges: number;
  branches: number;
  depth: number;
}

export interface DerivedMap {
  doc: MindMapDocument | null;
  palette: Palette;
  /** Fixed visual language shared by the canvas and every export format. */
  mapStyle: MapStyle;
  sizes: Record<string, MeasuredNode>;
  positions: Record<string, Point>;
  visibleIds: string[];
  visibleSet: Set<string>;
  byParent: Record<string, MindNode[]>;
  branchIndices: Record<string, number>;
  depth: Record<string, number>;
  bounds: Rect;
  stats: DerivedStats;
  /** Non-null while Focus Mode is active: the focused subtree plus its ancestors. */
  focusSet: Set<string> | null;
}

interface Structure {
  byParentIds: Record<string, string[]>;
  byParent: Record<string, MindNode[]>;
  visibleIds: string[];
  visibleSet: Set<string>;
  depth: Record<string, number>;
  branchIndices: Record<string, number>;
  focusSet: Set<string> | null;
  stats: DerivedStats;
}

interface Cache {
  doc: MindMapDocument;
  theme: ThemeKind;
  focusRootId: string | null;
  showDescriptions: boolean;
  nodes: Record<string, MindNode>;
  structure: Structure;
  positions: Record<string, Point>;
  sizes: Record<string, MeasuredNode>;
  result: DerivedMap;
}

export const EMPTY_DERIVED: DerivedMap = {
  doc: null,
  palette: getPalette('light'),
  mapStyle: MAP_STYLE,
  sizes: {},
  positions: {},
  visibleIds: [],
  visibleSet: new Set(),
  byParent: {},
  branchIndices: {},
  depth: {},
  bounds: { x: -400, y: -300, width: 800, height: 600 },
  stats: { nodes: 0, edges: 0, branches: 0, depth: 0 },
  focusSet: null,
};

function compareSiblings(a: MindNode, b: MindNode): number {
  const ao = Number(a.metadata.order ?? a.createdAt);
  const bo = Number(b.metadata.order ?? b.createdAt);
  return ao - bo || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/**
 * Build the structural slice once. It only depends on parent links, collapse
 * state, sibling order and the focus root — not on titles, notes or colours.
 */
function buildStructure(doc: MindMapDocument, focusRootId: string | null): Structure {
  const byParentIds: Record<string, string[]> = {};
  for (const node of Object.values(doc.nodes)) {
    if (node.parentId) (byParentIds[node.parentId] ??= []).push(node.id);
  }
  for (const list of Object.values(byParentIds)) {
    list.sort((a, b) => compareSiblings(doc.nodes[a], doc.nodes[b]));
  }

  const byParent: Record<string, MindNode[]> = {};
  for (const [parentId, ids] of Object.entries(byParentIds)) {
    byParent[parentId] = ids.map((id) => doc.nodes[id]).filter(Boolean);
  }

  const visibleIds: string[] = [];
  const stack = [doc.rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    visibleIds.push(id);
    if (!node.collapsed) {
      const children = byParentIds[id] ?? [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }

  // Depth is needed for every node (not only visible ones) for the stats panel
  // and edge widths. A single BFS is O(n); the old per-node ancestor walk was O(n·depth).
  const depth: Record<string, number> = { [doc.rootId]: 0 };
  const queue = [doc.rootId];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const childId of byParentIds[id] ?? []) {
      depth[childId] = (depth[id] ?? 0) + 1;
      queue.push(childId);
    }
  }
  let maxDepth = 0;
  for (const value of Object.values(depth)) maxDepth = Math.max(maxDepth, value);

  const branchIndices: Record<string, number> = { [doc.rootId]: -1 };
  (byParentIds[doc.rootId] ?? []).forEach((childId, index) => {
    branchIndices[childId] = index % 8;
    const walk = [childId];
    while (walk.length) {
      const id = walk.pop()!;
      for (const grandChild of byParentIds[id] ?? []) {
        branchIndices[grandChild] = index % 8;
        walk.push(grandChild);
      }
    }
  });

  let focusSet: Set<string> | null = null;
  if (focusRootId && doc.nodes[focusRootId]) {
    focusSet = new Set<string>();
    const walk = [focusRootId];
    while (walk.length) {
      const id = walk.pop()!;
      if (focusSet.has(id)) continue;
      focusSet.add(id);
      for (const childId of byParentIds[id] ?? []) walk.push(childId);
    }
    let cursor: string | null = doc.nodes[focusRootId].parentId;
    while (cursor) {
      focusSet.add(cursor);
      cursor = doc.nodes[cursor]?.parentId ?? null;
    }
  }

  return {
    byParentIds,
    byParent,
    visibleIds,
    visibleSet: new Set(visibleIds),
    depth,
    branchIndices,
    focusSet,
    stats: {
      nodes: Object.keys(doc.nodes).length,
      edges: Object.values(doc.edges).filter((edge) => edge.kind === 'relation').length,
      branches: (byParentIds[doc.rootId] ?? []).length,
      depth: maxDepth,
    },
  };
}

let cache: Cache | null = null;

/**
 * Incremental derived state.
 *
 * A document edit (typing, style slider, undo) replaces one node object. The
 * structural slice, positions and every unchanged node's measurement are reused,
 * so the work scales with what actually changed instead of re-scanning the map.
 * Structural commands (add/delete/move/collapse/reparent) still rebuild.
 */
export function buildDerived(
  doc: MindMapDocument | null,
  theme: ThemeKind,
  focusRootId: string | null,
): DerivedMap {
  const palette = getPalette(theme);
  if (!doc) return { ...EMPTY_DERIVED, palette };

  const previous = cache && cache.theme === theme ? cache : null;
  const changed: string[] = [];
  let addedOrRemoved = !previous;
  if (previous) {
    const nodeEntries = Object.entries(doc.nodes);
    for (const [id, node] of nodeEntries) {
      const old = previous.nodes[id];
      if (!old) {
        addedOrRemoved = true;
        changed.push(id);
      } else if (old !== node) {
        changed.push(id);
      }
    }
    if (!addedOrRemoved && Object.keys(previous.nodes).length !== nodeEntries.length) addedOrRemoved = true;
  }

  let structureChanged = !previous || addedOrRemoved || previous.doc.rootId !== doc.rootId || previous.focusRootId !== focusRootId;
  if (!structureChanged && previous) {
    for (const id of changed) {
      const before = previous.nodes[id];
      const after = doc.nodes[id];
      if (!before || !after) continue;
      if (before.parentId !== after.parentId || before.collapsed !== after.collapsed || before.metadata.order !== after.metadata.order) {
        structureChanged = true;
        break;
      }
    }
  }

  let structure: Structure;
  if (structureChanged || !previous) {
    structure = buildStructure(doc, focusRootId);
  } else {
    // Same shape: refresh only the node objects that changed (Outline renders
    // titles from `byParent`, so stale references would show stale text).
    const byParent = { ...previous.structure.byParent };
    let patched = true;
    for (const id of changed) {
      const node = doc.nodes[id];
      if (!node?.parentId) continue;
      const list = byParent[node.parentId];
      const index = list?.findIndex((candidate) => candidate.id === id) ?? -1;
      if (!list || index < 0) {
        patched = false;
        break;
      }
      const copy = list.slice();
      copy[index] = node;
      byParent[node.parentId] = copy;
    }
    structure = patched ? { ...previous.structure, byParent } : buildStructure(doc, focusRootId);
  }

  const showDescriptions = doc.settings.showDescriptions;
  let sizes: Record<string, MeasuredNode>;
  if (!previous || addedOrRemoved || previous.showDescriptions !== showDescriptions) {
    sizes = measureAll(Object.values(doc.nodes), showDescriptions, doc.rootId);
  } else {
    sizes = { ...previous.sizes };
    for (const id of changed) {
      const node = doc.nodes[id];
      if (node) sizes[id] = measureNode(node, showDescriptions, id === doc.rootId);
      else delete sizes[id];
    }
  }

  let positions: Record<string, Point>;
  if (!previous || addedOrRemoved) {
    positions = {};
    for (const node of Object.values(doc.nodes)) positions[node.id] = node.position;
  } else {
    const moved = changed.some((id) => previous.nodes[id]?.position !== doc.nodes[id]?.position);
    if (moved) {
      positions = {};
      for (const node of Object.values(doc.nodes)) positions[node.id] = node.position;
    } else {
      positions = previous.positions;
    }
  }

  const geometryChanged = !previous || structureChanged || addedOrRemoved || changed.length > 0 || positions !== previous.positions;
  const bounds = geometryChanged
    ? computeBounds(positions, sizes, structure.visibleIds, 90)
    : previous!.result.bounds;

  const result: DerivedMap = {
    doc,
    palette,
    mapStyle: MAP_STYLE,
    sizes,
    positions,
    visibleIds: structure.visibleIds,
    visibleSet: structure.visibleSet,
    byParent: structure.byParent,
    branchIndices: structure.branchIndices,
    depth: structure.depth,
    bounds,
    stats: structure.stats,
    focusSet: structure.focusSet,
  };

  cache = {
    doc,
    theme,
    focusRootId,
    showDescriptions,
    nodes: doc.nodes,
    structure,
    positions,
    sizes,
    result,
  };
  return result;
}

/** Test/benchmark hook: drop the incremental cache. */
export function resetDerivedCache(): void {
  cache = null;
}
