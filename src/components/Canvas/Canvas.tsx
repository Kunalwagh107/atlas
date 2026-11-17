import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { effectiveEdgeWidth } from '../../core/mindmap/appearance';
import { measureNode } from '../../core/layout/measure';
import { isVisible } from '../../core/mindmap/operations';
import { branchColor } from '../../core/mindmap/palette';
import type { Point, Rect } from '../../core/mindmap/types';
import { actions } from '../../state/actions';
import { controller } from '../../state/controller';
import { useDerived } from '../../state/derived';
import { store, useAppStore } from '../../state/store';
import { clamp } from '../../utils/common';
import { Icon } from '../common/Icon';
import { useImageSources } from '../common/useImageSources';
import { HierarchyEdge, RelationEdge } from './EdgeView';
import { InlineEditor } from './InlineEditor';
import { Minimap } from './Minimap';
import { NodeToolbar, nodeToolbarWidth } from './NodeToolbar';
import { NodeView, type ResizeCorner, type SearchMark } from './NodeView';
import { AlignmentGuides, ConflictBanner, FocusBanner, LassoOverlay, PresentationChrome, type ScreenRect } from './Overlays';
import {
  centerRect,
  hierarchyPath,
  rectsIntersect,
  relationPath,
  screenToWorld,
  viewportWorldRect,
  worldToScreen,
} from './viewport';

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; startClient: Point; startX: number; startY: number; pointerId: number; captured: boolean }
  | { kind: 'lasso'; start: Point; additive: boolean; rightButton: boolean; pointerId: number; moved: boolean; captured: boolean }
  | {
      kind: 'drag';
      startClient: Point;
      startPositions: Record<string, Point>;
      ids: string[];
      moved: boolean;
      pointerId: number;
      captured: boolean;
    }
  | {
      kind: 'resize';
      id: string;
      corner: ResizeCorner;
      startClient: Point;
      startWidth: number;
      startHeight: number;
      startCenter: Point;
      pointerId: number;
      captured: boolean;
    };

const MIN_RESIZE_WIDTH = 120;
const MAX_RESIZE_WIDTH = 1200;
const MIN_RESIZE_HEIGHT = 44;
const MAX_RESIZE_HEIGHT = 800;

export function Canvas() {
  const derived = useDerived();
  const {
    doc, palette, mapStyle, sizes: derivedSizes, positions: basePositions, visibleIds, visibleSet,
    byParent, branchIndices, depth, focusSet,
  } = derived;
  const viewport = useAppStore((s) => s.viewport);
  const selection = useAppStore((s) => s.selection);
  const search = useAppStore((s) => s.search);
  const canvasSize = useAppStore((s) => s.ui.canvasSize);
  const linkSourceId = useAppStore((s) => s.ui.linkSourceId);
  const editingNodeId = useAppStore((s) => s.ui.editingNodeId);
  const selectedEdgeId = useAppStore((s) => s.ui.selectedEdgeId);
  const contextMenuOpen = useAppStore((s) => s.ui.contextMenu.open);
  const focusRootId = useAppStore((s) => s.ui.focusRootId);
  const presentation = useAppStore((s) => s.ui.presentation);
  const dragPositions = useAppStore((s) => s.dragPositions);
  const resizePreview = useAppStore((s) => s.resizePreview);
  const conflict = useAppStore((s) => s.ui.conflict);

  const imageRefs = useMemo(
    () => doc ? Object.values(doc.nodes).flatMap((node) => node.content?.images ?? []) : [],
    [doc],
  );
  const imageUrls = useImageSources(doc?.id ?? null, imageRefs);

  /** Merge transient drag/resize geometry onto the document values. The derived
   * context stays stable during a gesture; only the canvas needs the live values. */
  const positions = useMemo(() => {
    let result = dragPositions && Object.keys(dragPositions).length
      ? { ...basePositions, ...dragPositions }
      : basePositions;
    if (resizePreview) result = { ...result, [resizePreview.id]: resizePreview.position };
    return result;
  }, [basePositions, dragPositions, resizePreview]);

  const sizes = useMemo(() => {
    if (!resizePreview || !doc) return derivedSizes;
    const node = doc.nodes[resizePreview.id];
    if (!node || !derivedSizes[resizePreview.id]) return derivedSizes;
    const measured = measureNode(
      {
        ...node,
        style: { ...node.style, width: resizePreview.width, height: resizePreview.height },
      },
      doc.settings.showDescriptions,
      resizePreview.id === doc.rootId,
    );
    return { ...derivedSizes, [resizePreview.id]: measured };
  }, [resizePreview, doc, derivedSizes]);

  const [lassoMode, setLassoMode] = useState(false);
  const [lassoRect, setLassoRect] = useState<ScreenRect | null>(null);
  const lassoRectRef = useRef<ScreenRect | null>(null);
  const [lassoFromRight, setLassoFromRight] = useState(false);
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [presentPlaying, setPresentPlaying] = useState(false);
  const [presentSpeed, setPresentSpeed] = useState(1500);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture>({ kind: 'none' });
  const derivedRef = useRef(derived);
  derivedRef.current = derived;
  /** Set on right-button release so the following contextmenu can be suppressed. */
  const rightDragRef = useRef<{ moved: boolean; at: number } | null>(null);
  const spaceRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<Point | null>(null);
  const pinchRef = useRef<number | null>(null);

  /** Autoplay for Presentation Mode: one timer per step, never a runaway loop. */
  useEffect(() => {
    if (!presentation.active) {
      setPresentPlaying(false);
      return;
    }
    if (!presentPlaying) return;
    if (presentation.index >= presentation.order.length - 1) {
      setPresentPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => actions.presentationStep(1), presentSpeed);
    return () => window.clearTimeout(timer);
  }, [presentation.active, presentation.index, presentation.order.length, presentPlaying, presentSpeed]);

  /* ---------- canvas measurement ---------- */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) store.dispatch({ type: 'SET_CANVAS_SIZE', width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* ---------- wheel zoom (non-passive so we can prevent page scroll) ---------- */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        actions.panBy(-delta, 0);
        return;
      }
      const factor = clamp(Math.exp(-delta * 0.0016), 0.55, 1.8);
      actions.zoomAt(factor, screen);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- space-bar pan modifier ---------- */
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) {
        spaceRef.current = true;
        const element = containerRef.current;
        if (element) element.classList.add('is-space-pan');
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false;
        containerRef.current?.classList.remove('is-space-pan');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* ---------- two-finger pinch zoom on touch devices ---------- */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (event: TouchEvent) => {
      pinchRef.current = event.touches.length === 2 ? distance(event.touches) : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const next = distance(event.touches);
      const previous = pinchRef.current;
      pinchRef.current = next;
      if (previous === null || previous < 1) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const center = {
        x: (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left,
        y: (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top,
      };
      actions.zoomAt(clamp(next / previous, 0.6, 1.6), center);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinchRef.current = null;
    };
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  /* ---------- gesture processing (rAF throttled) ---------- */
  const clientToScreen = useCallback((client: Point): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: client.x - (rect?.left ?? 0), y: client.y - (rect?.top ?? 0) };
  }, []);

  /**
   * Pointer capture is taken *lazily*, only once a gesture actually moves.
   * Capturing on pointerdown retargets the follow-up click/dblclick to the
   * container, which is why double-click editing never reached a node.
   */
  const capturePointer = useCallback((gesture: Exclude<Gesture, { kind: 'none' }>) => {
    if (gesture.captured) return;
    gesture.captured = true;
    try {
      containerRef.current?.setPointerCapture(gesture.pointerId);
    } catch {
      /* pointer already gone — the gesture still works inside the canvas */
    }
  }, []);

  const processMove = useCallback((client: Point) => {
    const gesture = gestureRef.current;
    if (gesture.kind === 'pan') {
      capturePointer(gesture);
      actions.setViewport(
        gesture.startX + client.x - gesture.startClient.x,
        gesture.startY + client.y - gesture.startClient.y,
        store.getState().viewport.zoom,
      );
    } else if (gesture.kind === 'lasso') {
      capturePointer(gesture);
      const current = clientToScreen(client);
      const rect: ScreenRect = {
        x: Math.min(gesture.start.x, current.x),
        y: Math.min(gesture.start.y, current.y),
        width: Math.abs(current.x - gesture.start.x),
        height: Math.abs(current.y - gesture.start.y),
      };
      if (rect.width > 4 || rect.height > 4) gesture.moved = true;
      lassoRectRef.current = rect;
      setLassoRect(rect);
    } else if (gesture.kind === 'drag') {
      const dx = client.x - gesture.startClient.x;
      const dy = client.y - gesture.startClient.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
      gesture.moved = true;
      capturePointer(gesture);
      const zoom = store.getState().viewport.zoom;
      const next: Record<string, Point> = {};
      for (const [id, start] of Object.entries(gesture.startPositions)) {
        next[id] = { x: start.x + dx / zoom, y: start.y + dy / zoom };
      }
      actions.dragMove(next);
    } else if (gesture.kind === 'resize') {
      capturePointer(gesture);
      const zoom = store.getState().viewport.zoom;
      const signX = gesture.corner === 'nw' || gesture.corner === 'sw' ? -1 : 1;
      const signY = gesture.corner === 'nw' || gesture.corner === 'ne' ? -1 : 1;
      const width = clamp(
        gesture.startWidth + (signX * (client.x - gesture.startClient.x)) / zoom,
        MIN_RESIZE_WIDTH, MAX_RESIZE_WIDTH,
      );
      const height = clamp(
        gesture.startHeight + (signY * (client.y - gesture.startClient.y)) / zoom,
        MIN_RESIZE_HEIGHT, MAX_RESIZE_HEIGHT,
      );
      actions.setResizePreview({
        id: gesture.id,
        width,
        height,
        position: {
          x: gesture.startCenter.x + (signX * (width - gesture.startWidth)) / 2,
          y: gesture.startCenter.y + (signY * (height - gesture.startHeight)) / 2,
        },
      });
    }
  }, [clientToScreen, capturePointer]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (gestureRef.current.kind === 'none') return;
      pendingRef.current = { x: event.clientX, y: event.clientY };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          if (pendingRef.current) processMove(pendingRef.current);
        });
      }
    },
    [processMove],
  );

  const finishGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      if (pendingRef.current) processMove(pendingRef.current);
    }
    pendingRef.current = null;
    const gesture = gestureRef.current;
    if (gesture.kind === 'drag') {
      actions.endDrag();
      setDragIds([]);
    } else if (gesture.kind === 'resize') {
      const preview = store.getState().resizePreview;
      if (preview) actions.resizeNode(preview.id, preview.width, preview.height, preview.position);
      actions.setResizePreview(null);
    } else if (gesture.kind === 'lasso') {
      const state = store.getState();
      const currentDoc = state.history.present;
      const rect = lassoRectRef.current;
      const dragged = !!rect && rect.width > 4 && rect.height > 4;
      // A plain right-click still opens the context menu; a right-DRAG selects.
      if (gesture.rightButton) rightDragRef.current = { moved: dragged, at: Date.now() };
      if (currentDoc && dragged) {
        const a = screenToWorld({ x: rect!.x, y: rect!.y }, state.viewport);
        const b = screenToWorld({ x: rect!.x + rect!.width, y: rect!.y + rect!.height }, state.viewport);
        const worldBox: Rect = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
        const { sizes: measured, positions: worldPositions } = derivedRef.current;
        const inside = Object.values(currentDoc.nodes).filter((node) => {
          if (!isVisible(currentDoc, node.id)) return false;
          const size = measured[node.id];
          if (!size) return false;
          return rectsIntersect(centerRect(worldPositions[node.id] ?? node.position, size), worldBox);
        }).map((node) => node.id);
        const ids = gesture.additive
          ? [...new Set([...state.selection.ids, ...inside])]
          : inside;
        actions.select(ids);
        if (inside.length > 1) actions.toast(`${inside.length} nodes selected`, 'info');
      }
      lassoRectRef.current = null;
      setLassoRect(null);
      setLassoFromRight(false);
    }
    gestureRef.current = { kind: 'none' };
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
  }, [processMove]);

  /* ---------- background interactions ---------- */
  const worldFromEvent = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    const screen = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    return screenToWorld(screen, store.getState().viewport);
  }, []);

  const startLasso = useCallback((event: ReactPointerEvent<Element>, rightButton: boolean) => {
    const start = clientToScreen({ x: event.clientX, y: event.clientY });
    gestureRef.current = {
      kind: 'lasso', start, additive: event.shiftKey, rightButton,
      pointerId: event.pointerId, moved: false, captured: false,
    };
    lassoRectRef.current = { x: start.x, y: start.y, width: 0, height: 0 };
    setLassoRect(lassoRectRef.current);
    setLassoFromRight(rightButton);
    rightDragRef.current = null;
  }, [clientToScreen]);

  /** Overlays are siblings of the SVG; their pointer events are not canvas gestures. */
  const isOverlayTarget = useCallback((target: EventTarget | null): boolean => {
    const element = target instanceof Element ? target : null;
    return !!element?.closest(
      '.node-toolbar, .minimap, .canvas-controls, .canvas-hint, .focus-banner, .link-banner, .presentation-chrome, .inline-editor, .lasso-rect',
    );
  }, []);

  const onBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isOverlayTarget(event.target)) return;
      // Right-button drag is a marquee selection; a plain right-click still
      // opens the context menu (see the contextmenu handlers below).
      if (event.button === 2) {
        event.preventDefault();
        startLasso(event, true);
        return;
      }
      if (event.button !== 0 && event.button !== 1) return;
      if (store.getState().ui.linkSourceId) actions.cancelLink();
      if (lassoMode && !spaceRef.current && event.button === 0) {
        startLasso(event, false);
        return;
      }
      const state = store.getState();
      if (!spaceRef.current && (state.selection.ids.length || state.ui.selectedEdgeId)) {
        actions.clearSelection();
        actions.selectEdge(null);
        actions.setEditing(null);
      }
      gestureRef.current = {
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startX: state.viewport.x,
        startY: state.viewport.y,
        pointerId: event.pointerId,
        captured: false,
      };
    },
    [lassoMode, startLasso],
  );

  const onBackgroundDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      actions.addNodeAt(worldFromEvent(event));
    },
    [worldFromEvent],
  );

  /**
   * Fallback for the case where a pointer capture (from another gesture) still
   * retargets dblclick to the container. Resolve the real target from the point
   * under the cursor instead of trusting event.target.
   */
  const onRootDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target !== containerRef.current) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (element?.closest('.node-toolbar, .canvas-controls, .minimap, .presentation-chrome, .focus-banner, .link-banner, .inline-editor')) return;
      const id = element?.closest('.map-node')?.getAttribute('data-node-id');
      if (id) actions.setEditing(id);
      else actions.addNodeAt(worldFromEvent(event));
    },
    [worldFromEvent],
  );

  const contextMenuSuppressed = useCallback((): boolean => {
    const recent = rightDragRef.current;
    if (!recent?.moved || Date.now() - recent.at > 500) return false;
    rightDragRef.current = null;
    return true;
  }, []);

  const onBackgroundContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (isOverlayTarget(event.target)) return;
      if (contextMenuSuppressed()) return;
      actions.showContextMenu(event.clientX, event.clientY, worldFromEvent(event), 'canvas', null);
    },
    [worldFromEvent, contextMenuSuppressed, isOverlayTarget],
  );

  /* ---------- node interactions ---------- */
  const onNodePointerDown = useCallback((event: ReactPointerEvent<SVGGElement>, id: string) => {
    // Right-button events must bubble to the SVG so a right-drag can start a
    // marquee; a plain right-click is handled by onNodeContextMenu.
    if (event.button !== 0 || spaceRef.current) return;
    event.stopPropagation();
    const state = store.getState();
    const current = state.history.present;
    if (!current) return;
    if (state.ui.linkSourceId) {
      actions.finishLink(id);
      return;
    }
    if (event.shiftKey) {
      const ids = state.selection.ids.includes(id)
        ? state.selection.ids.filter((value) => value !== id)
        : [...state.selection.ids, id];
      actions.select(ids);
      actions.setUI({ sidebarOpen: true, sidebarTab: 'inspector' });
      return;
    }
    if (!state.selection.ids.includes(id) || state.selection.ids.length !== 1) actions.revealNode(id);
    const ids = store.getState().selection.ids.filter((nodeId) => !!current.nodes[nodeId]);
    const dragIds = ids.length ? ids : [id];
    const startPositions: Record<string, Point> = {};
    for (const nodeId of dragIds) startPositions[nodeId] = { ...current.nodes[nodeId].position };
    gestureRef.current = {
      kind: 'drag',
      startClient: { x: event.clientX, y: event.clientY },
      startPositions,
      ids: dragIds,
      moved: false,
      pointerId: event.pointerId,
      captured: false,
    };
    actions.beginDrag('Move nodes');
    setDragIds(dragIds);
  }, []);

  const onResizeStart = useCallback((event: ReactPointerEvent<SVGRectElement>, id: string, corner: ResizeCorner) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const state = store.getState();
    const current = state.history.present;
    const node = current?.nodes[id];
    const measured = derivedRef.current.sizes[id];
    if (!node || !measured) return;
    actions.select([id]);
    gestureRef.current = {
      kind: 'resize',
      id,
      corner,
      startClient: { x: event.clientX, y: event.clientY },
      startWidth: measured.width,
      startHeight: measured.height,
      startCenter: { ...(derivedRef.current.positions[id] ?? node.position) },
      pointerId: event.pointerId,
      captured: false,
    };
  }, []);

  const onNodeDoubleClick = useCallback((event: ReactMouseEvent<SVGGElement>, id: string) => {
    event.stopPropagation();
    actions.setEditing(id);
  }, []);

  /** SVG nodes are keyboard reachable: Enter/Space selects, F2 edits, Tab adds a child. */
  const onNodeKeyActivate = useCallback((event: ReactKeyboardEvent<SVGGElement>, id: string) => {
    // Keys handled here must not bubble to the window-level shortcut handler,
    // which would otherwise add a second child / sibling for one keypress.
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab' || event.key === 'F2') {
      event.stopPropagation();
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      actions.select([id], { focus: true });
    } else if (event.key === 'F2') {
      event.preventDefault();
      actions.setEditing(id);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      actions.addChild(id);
    }
  }, []);

  const onNodeContextMenu = useCallback((event: ReactMouseEvent<SVGGElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (contextMenuSuppressed()) return;
    actions.select([id]);
    actions.showContextMenu(event.clientX, event.clientY, worldFromEvent(event), 'node', id);
  }, [worldFromEvent, contextMenuSuppressed]);

  const onToggleCollapse = useCallback((id: string) => actions.toggleCollapse(id), []);

  const onEdgePointerDown = useCallback((event: ReactPointerEvent<SVGPathElement>, id: string) => {
    event.stopPropagation();
    actions.selectEdge(id);
  }, []);

  const onEdgeContextMenu = useCallback((event: ReactMouseEvent<SVGGElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    actions.showContextMenu(event.clientX, event.clientY, worldFromEvent(event), 'edge', id);
  }, [worldFromEvent]);

  /* ---------- culling / virtualization ---------- */
  const worldRect = useMemo(
    () => viewportWorldRect(viewport, canvasSize.width, canvasSize.height, 180),
    [viewport, canvasSize],
  );

  /**
   * Culling rect snapped to a coarse world grid. Rebuilding the visible set on
   * every pan frame also rebuilt every edge path and re-rendered every node; with
   * the grid, a small pan reuses the same set and only the transform changes.
   */
  const cullRect = useMemo(() => {
    const step = 512;
    const x = Math.floor(worldRect.x / step) * step;
    const y = Math.floor(worldRect.y / step) * step;
    const right = Math.ceil((worldRect.x + worldRect.width) / step) * step;
    const bottom = Math.ceil((worldRect.y + worldRect.height) / step) * step;
    return { x, y, width: right - x, height: bottom - y };
  }, [worldRect]);

  // Zoom is announced only once the gesture settles, otherwise every wheel tick
  // re-queues a screen-reader announcement.
  const [announcedZoom, setAnnouncedZoom] = useState(() => Math.round(viewport.zoom * 100));
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncedZoom(Math.round(viewport.zoom * 100)), 600);
    return () => clearTimeout(timer);
  }, [viewport.zoom]);

  const renderedIds = useMemo(() => {
    if (!doc) return [];
    return visibleIds.filter((id) => {
      const p = positions[id];
      const s = sizes[id];
      return p && s && rectsIntersect(centerRect(p, s), cullRect);
    });
  }, [doc, visibleIds, positions, sizes, cullRect]);

  const renderedSet = useMemo(() => new Set(renderedIds), [renderedIds]);
  const matchSet = useMemo(() => new Set(search.matches), [search.matches]);
  const activeMatchId = search.activeIndex >= 0 ? search.matches[search.activeIndex] : null;
  const selectedSet = useMemo(() => new Set(selection.ids), [selection.ids]);

  const hierarchyEdges = useMemo(() => {
    if (!doc) return [];
    const result: { id: string; path: string; color: string; width: number; dimmed: boolean; dash: string | null }[] = [];
    for (const id of visibleIds) {
      const node = doc.nodes[id];
      if (!node?.parentId || !visibleSet.has(node.parentId)) continue;
      if (!renderedSet.has(id) && !renderedSet.has(node.parentId)) continue;
      const parent = doc.nodes[node.parentId];
      const parentSize = sizes[node.parentId];
      const childSize = sizes[id];
      if (!parent || !parentSize || !childSize) continue;
      const geometry = hierarchyPath(
        positions[node.parentId!] ?? parent.position, parentSize,
        positions[id] ?? node.position, childSize,
      );
      const level = depth[id] ?? 1;
      result.push({
        id,
        path: geometry.path,
        color: branchColor(branchIndices[id] ?? -1, palette),
        width: effectiveEdgeWidth(level),
        dimmed: !!focusSet && !focusSet.has(id),
        dash: mapStyle.edgeDash,
      });
    }
    return result;
  }, [doc, visibleIds, visibleSet, renderedSet, positions, sizes, depth, branchIndices, palette, focusSet, mapStyle]);

  const relationEdges = useMemo(() => {
    if (!doc) return [];
    return Object.values(doc.edges)
      .filter((edge) => edge.kind === 'relation' && doc.nodes[edge.source] && doc.nodes[edge.target])
      .filter((edge) => visibleSet.has(edge.source) && visibleSet.has(edge.target))
      .filter((edge) => renderedSet.has(edge.source) || renderedSet.has(edge.target))
      .map((edge) => {
        const from = doc.nodes[edge.source];
        const to = doc.nodes[edge.target];
        const geometry = relationPath(positions[from.id] ?? from.position, sizes[from.id], positions[to.id] ?? to.position, sizes[to.id]);
        return { edge, geometry };
      });
  }, [doc, visibleSet, renderedSet, positions, sizes]);

  const editingNode = editingNodeId && doc?.nodes[editingNodeId] ? doc.nodes[editingNodeId] : null;
  const toolbarNode = selection.primaryId && doc?.nodes[selection.primaryId] ? doc.nodes[selection.primaryId] : null;
  const toolbarSize = toolbarNode ? sizes[toolbarNode.id] : null;

  // Announced through the polite live region so keyboard/screen-reader users hear
  // what the selection moved to (the SVG nodes are focusable but silent).
  const selectionLabel = useMemo(() => {
    if (!doc || !selection.ids.length) return '';
    if (selection.ids.length > 1) return `${selection.ids.length} nodes`;
    return doc.nodes[selection.ids[0]]?.title ?? '';
  }, [doc, selection.ids]);

  /** Pick a toolbar lane that does not cover any neighbouring node. */
  const toolbarPosition = useMemo(() => {
    if (!toolbarNode || !toolbarSize || !doc) return { left: 0, top: 0, placement: 'above' as const };
    const width = nodeToolbarWidth(toolbarNode, toolbarNode.id !== doc.rootId);
    const height = 38;
    const center = worldToScreen(positions[toolbarNode.id] ?? toolbarNode.position, viewport);
    const halfW = (toolbarSize.width / 2) * viewport.zoom;
    const halfH = (toolbarSize.height / 2) * viewport.zoom;
    const candidates: { left: number; top: number; placement: 'above' | 'below' | 'side' }[] = [
      { left: center.x - width / 2, top: center.y - halfH - 48, placement: 'above' },
      { left: center.x - width / 2, top: center.y + halfH + 10, placement: 'below' },
      { left: center.x + halfW + 14, top: center.y - height / 2, placement: 'side' },
      { left: center.x - halfW - 14 - width, top: center.y - height / 2, placement: 'side' },
    ];
    const obstacles: Rect[] = [];
    for (const id of visibleIds) {
      if (id === toolbarNode.id) continue;
      const node = doc.nodes[id];
      const size = sizes[id];
      if (!node || !size) continue;
      const point = worldToScreen(positions[id] ?? node.position, viewport);
      obstacles.push({
        x: point.x - (size.width / 2) * viewport.zoom - 4,
        y: point.y - (size.height / 2) * viewport.zoom - 4,
        width: size.width * viewport.zoom + 8,
        height: size.height * viewport.zoom + 8,
      });
    }
    const inside = (candidate: (typeof candidates)[number]) =>
      candidate.left >= 8 &&
      candidate.top >= 8 &&
      candidate.left + width <= canvasSize.width - 8 &&
      candidate.top + height <= canvasSize.height - 48;
    const clear = (candidate: (typeof candidates)[number]) =>
      !obstacles.some((obstacle) =>
        rectsIntersect({ x: candidate.left, y: candidate.top, width, height }, obstacle),
      );
    const chosen = candidates.find((c) => inside(c) && clear(c)) ?? candidates.find(inside) ?? candidates[0];
    return {
      left: clamp(chosen.left, 8, Math.max(8, canvasSize.width - width - 8)),
      top: clamp(chosen.top, 8, Math.max(8, canvasSize.height - height - 48)),
      placement: chosen.placement,
    };
  }, [toolbarNode, toolbarSize, doc, viewport, visibleIds, sizes, canvasSize, positions]);

  const gridStyle = {
    '--grid-size': `${24 * viewport.zoom}px`,
    '--grid-x': `${viewport.x}px`,
    '--grid-y': `${viewport.y}px`,
  } as CSSProperties;

  const onMinimapNavigate = useCallback((world: Point) => {
    const vp = store.getState().viewport;
    const size = store.getState().ui.canvasSize;
    actions.setViewport(size.width / 2 - world.x * vp.zoom, size.height / 2 - world.y * vp.zoom, vp.zoom);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`canvas-root ${doc?.settings.showGrid ? 'has-grid' : ''} ${linkSourceId ? 'is-linking' : ''} ${presentation.active ? 'is-presenting' : ''} ${lassoMode ? 'is-lasso' : ''}`}
      style={gridStyle}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
      onDoubleClick={onRootDoubleClick}
      onContextMenu={onBackgroundContextMenu}
    >
      <svg
        ref={svgRef}
        className="canvas-svg"
        width={canvasSize.width}
        height={canvasSize.height}
        style={{ fontFamily: mapStyle.fontFamily }}
        onDoubleClick={onBackgroundDoubleClick}
        role="group"
        aria-label="Mind map canvas"
      >
        <defs>
          <marker id="atlas-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L9,4.5 L0,9 z" fill={palette.relation} />
          </marker>
        </defs>
        <rect className="canvas-hit" x={0} y={0} width={canvasSize.width} height={canvasSize.height} fill="transparent" />
        <g
          data-scene="true"
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
            transition: viewport.animated && doc?.settings.animated ? 'transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1)' : 'none',
          }}
        >
          <g className="canvas-edges">
            {hierarchyEdges.map((edge) => (
              <HierarchyEdge
                key={edge.id}
                path={edge.path}
                color={edge.color}
                width={edge.width}
                opacity={edge.dimmed ? 0.12 : 0.82}
                dash={edge.dash}
              />
            ))}
            {relationEdges.map(({ edge, geometry }) => (
              <RelationEdge
                key={edge.id}
                id={edge.id}
                path={geometry.path}
                label={edge.label}
                labelX={geometry.midpoint.x}
                labelY={geometry.midpoint.y}
                palette={palette}
                selected={selectedEdgeId === edge.id}
                dimmed={!!focusSet && !focusSet.has(edge.source) && !focusSet.has(edge.target)}
                onPointerDown={onEdgePointerDown}
                onContextMenu={onEdgeContextMenu}
              />
            ))}
            <AlignmentGuides positions={positions} ids={visibleIds} dragIds={dragIds} />
          </g>
          <g className="canvas-nodes">
            {renderedIds.map((id) => {
              const node = doc!.nodes[id];
              const size = sizes[id];
              if (!node || !size) return null;
              const parent = node.parentId ? doc!.nodes[node.parentId] : null;
              const searchMark: SearchMark = matchSet.has(id)
                ? activeMatchId === id ? 'active' : 'match'
                : 'none';
              return (
                <NodeView
                  key={id}
                  node={node}
                  position={positions[id] ?? node.position}
                  size={size}
                  palette={palette}
                  mapStyle={mapStyle}
                  branchIdx={branchIndices[id] ?? -1}
                  isRoot={id === doc!.rootId}
                  selected={selectedSet.has(id)}
                  zoom={viewport.zoom}
                  dimmed={presentation.active
                    ? presentation.order[presentation.index] !== id
                    : !!focusSet && !focusSet.has(id)}
                  imageUrl={size.image ? imageUrls[node.content?.images?.[0]?.id ?? ''] : undefined}
                  searchMark={searchMark}
                  linking={!!linkSourceId && linkSourceId !== id}
                  linkSource={linkSourceId === id}
                  childCount={byParent[id]?.length ?? 0}
                  badgeOnLeft={!!parent && (positions[id]?.x ?? node.position.x) < (positions[parent.id]?.x ?? parent.position.x) - 10}
                  showResizeHandles={selection.ids.length === 1 && selectedSet.has(id) && !editingNode && !presentation.active && !linkSourceId}
                  onPointerDown={onNodePointerDown}
                  onDoubleClick={onNodeDoubleClick}
                  onContextMenu={onNodeContextMenu}
                  onToggleCollapse={onToggleCollapse}
                  onKeyActivate={onNodeKeyActivate}
                  onResizeStart={onResizeStart}
                />
              );
            })}
          </g>
        </g>
      </svg>

      {/* HTML overlays stay at a constant screen size regardless of zoom. */}
      {editingNode && sizes[editingNode.id] && (
        <InlineEditor
          key={editingNode.id}
          node={editingNode}
          position={positions[editingNode.id] ?? editingNode.position}
          size={sizes[editingNode.id]}
          viewport={viewport}
          fontFamily={sizes[editingNode.id].fontFamily}
          onCommit={(title) => {
            actions.editNode(editingNode.id, { title }, 'Edit node title');
            actions.setEditing(null);
          }}
          onCancel={() => actions.setEditing(null)}
        />
      )}
      {toolbarNode && toolbarSize && !editingNode && !contextMenuOpen && (
        <NodeToolbar
          key={toolbarNode.id}
          node={toolbarNode}
          left={toolbarPosition.left}
          top={toolbarPosition.top}
          placement={toolbarPosition.placement}
          canDelete={toolbarNode.id !== doc?.rootId}
        />
      )}

      {linkSourceId && (
        <div className="link-banner">
          <Icon name="link" size={15} />
          <span>Select a node to create a connection</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => actions.cancelLink()}>
            Cancel <span className="kbd">Esc</span>
          </button>
        </div>
      )}

      {conflict && doc && conflict.mapId === doc.id && (
        <ConflictBanner
          conflict={conflict}
          onCopy={() => void controller.resolveConflict('copy')}
          onReload={() => void controller.resolveConflict('reload')}
          onOverwrite={() => void controller.resolveConflict('overwrite')}
        />
      )}

      <LassoOverlay rect={lassoRect} right={lassoFromRight} />
      {focusRootId && doc?.nodes[focusRootId] && (
        <FocusBanner title={doc.nodes[focusRootId].title} onExit={() => actions.setFocusRoot(null)} />
      )}
      {presentation.active && doc && (() => {
        const currentId = presentation.order[presentation.index];
        const current = currentId ? doc.nodes[currentId] : null;
        return (
          <PresentationChrome
            index={presentation.index}
            total={presentation.order.length}
            title={current?.title ?? doc.title}
            description={current?.description ?? ''}
            playing={presentPlaying}
            speedMs={presentSpeed}
            onTogglePlay={() => setPresentPlaying((value) => !value)}
            onSpeedChange={setPresentSpeed}
            onExportGif={() => { setPresentPlaying(false); actions.openDialog('gif'); }}
            onExit={() => actions.endPresentation()}
          />
        );
      })()}

      <div className="canvas-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="icon-btn tooltip-host" data-tooltip="Zoom out (−)" aria-label="Zoom out" onClick={() => actions.zoomOut()}>
          <Icon name="minus" size={16} />
        </button>
        <button
          type="button"
          className="zoom-readout"
          title="Reset zoom to 100%"
          onClick={() => actions.setZoom(1)}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button type="button" className="icon-btn tooltip-host" data-tooltip="Zoom in (+)" aria-label="Zoom in" onClick={() => actions.zoomIn()}>
          <Icon name="plus" size={16} />
        </button>
        <span className="divider" />
        <button type="button" className="icon-btn tooltip-host" data-tooltip="Fit to screen (F)" aria-label="Fit to screen" onClick={() => actions.fit()}>
          <Icon name="fit" size={16} />
        </button>
        <button type="button" className="icon-btn tooltip-host" data-tooltip="Center on central topic" aria-label="Center map" onClick={() => actions.center()}>
          <Icon name="center" size={16} />
        </button>
        <span className="divider" />
        <button
          type="button"
          className={`icon-btn tooltip-host ${lassoMode ? 'is-active' : ''}`}
          data-tooltip="Marquee select — drag a box to select many nodes (or just right-drag)"
          aria-label="Marquee select"
          aria-pressed={lassoMode}
          onClick={() => setLassoMode((value) => !value)}
        >
          <Icon name="lasso" size={16} />
        </button>
      </div>

      {doc?.settings.showMinimap && (
        <Minimap
          derived={derived}
          positionsOverride={dragPositions ?? undefined}
          sizesOverride={sizes === derivedSizes ? undefined : sizes}
          viewport={viewport}
          width={canvasSize.width}
          height={canvasSize.height}
          onNavigate={onMinimapNavigate}
        />
      )}

      {doc && visibleIds.length === 1 && (
        <div className="canvas-hint">
          <Icon name="mouse-pointer" size={14} />
          <span>Double-click a node to rename · right-drag to select several · drag a corner to resize</span>
        </div>
      )}
      {!doc && <div className="canvas-idle" aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">
        {doc
          ? `${visibleIds.length} visible nodes, zoom ${announcedZoom} percent${
              selectionLabel ? `. Selected: ${selectionLabel}` : ''
            }`
          : 'No map open'}
      </span>
    </div>
  );
}
