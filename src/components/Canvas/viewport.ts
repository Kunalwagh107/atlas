import type { Point, Rect, Size } from '../../core/mindmap/types';
import type { Viewport } from '../../state/types';

export function worldToScreen(point: Point, vp: Viewport): Point {
  return { x: point.x * vp.zoom + vp.x, y: point.y * vp.zoom + vp.y };
}

export function screenToWorld(point: Point, vp: Viewport): Point {
  return { x: (point.x - vp.x) / vp.zoom, y: (point.y - vp.y) / vp.zoom };
}

export function viewportWorldRect(vp: Viewport, width: number, height: number, margin = 140): Rect {
  const m = margin / vp.zoom;
  return {
    x: -vp.x / vp.zoom - m,
    y: -vp.y / vp.zoom - m,
    width: width / vp.zoom + m * 2,
    height: height / vp.zoom + m * 2,
  };
}

export function centerRect(center: Point, size: Size): Rect {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2, ...size };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Point where a ray leaving a rectangle's centre crosses its border. */
export function rayRectExit(center: Point, size: Size, toward: Point, padding = 3): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const tx = dx === 0 ? Infinity : (size.width / 2 + padding) / Math.abs(dx);
  const ty = dy === 0 ? Infinity : (size.height / 2 + padding) / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

export interface EdgeGeometry {
  path: string;
  start: Point;
  end: Point;
}

/** Smooth cubic hierarchy connector that follows the dominant axis. */
export function hierarchyPath(
  parentCenter: Point,
  parentSize: Size,
  childCenter: Point,
  childSize: Size,
): EdgeGeometry {
  const dx = childCenter.x - parentCenter.x;
  const dy = childCenter.y - parentCenter.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  let start: Point;
  let end: Point;
  let path: string;
  if (horizontal) {
    const dir = dx >= 0 ? 1 : -1;
    start = { x: parentCenter.x + (dir * parentSize.width) / 2, y: parentCenter.y };
    end = { x: childCenter.x - (dir * childSize.width) / 2, y: childCenter.y };
    const bend = Math.max(20, Math.abs(end.x - start.x) * 0.45);
    path = `M ${start.x} ${start.y} C ${start.x + dir * bend} ${start.y}, ${end.x - dir * bend} ${end.y}, ${end.x} ${end.y}`;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    start = { x: parentCenter.x, y: parentCenter.y + (dir * parentSize.height) / 2 };
    end = { x: childCenter.x, y: childCenter.y - (dir * childSize.height) / 2 };
    const bend = Math.max(18, Math.abs(end.y - start.y) * 0.45);
    path = `M ${start.x} ${start.y} C ${start.x} ${start.y + dir * bend}, ${end.x} ${end.y - dir * bend}, ${end.x} ${end.y}`;
  }
  return { path, start, end };
}

/** Bowed dashed connector for related concepts (with a midpoint for the label). */
export function relationPath(
  fromCenter: Point,
  fromSize: Size,
  toCenter: Point,
  toSize: Size,
): EdgeGeometry & { midpoint: Point; control: Point } {
  const start = rayRectExit(fromCenter, fromSize, toCenter, 6);
  const end = rayRectExit(toCenter, toSize, fromCenter, 9);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(90, Math.max(28, length * 0.14));
  const control = {
    x: (start.x + end.x) / 2 - (dy / length) * bend,
    y: (start.y + end.y) / 2 + (dx / length) * bend,
  };
  const midpoint = {
    x: (start.x + 2 * control.x + end.x) / 4,
    y: (start.y + 2 * control.y + end.y) / 4,
  };
  return {
    path: `M ${start.x} ${start.y} Q ${control.x} ${control.y}, ${end.x} ${end.y}`,
    start,
    end,
    midpoint,
    control,
  };
}

export { iconForNode } from '../../core/mindmap/icons';
