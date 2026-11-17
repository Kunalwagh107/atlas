import type { LayoutKind, MindNode, NodeContent } from './types';

/**
 * Single source of truth for node visuals. Both `measure.ts` and `NodeView.tsx`
 * consume these helpers, which is what keeps text from clipping.
 *
 * Atlas has one fixed, professional map appearance. The only theme switch is the
 * application-level light/dark mode, handled entirely by `palette.ts`.
 */

export const BADGE_ROW_HEIGHT = 21;
export const BADGE_CHIP_HEIGHT = 15;
/** Reserved strip at the bottom of a node for the first attached image. */
export const IMAGE_STRIP = 54;
export const IMAGE_THUMB = 44;

export interface MapStyle {
  fontFamily: string;
  edgeWidth: number;
  edgeDash: string | null;
  borderRadius: number;
  shadowOpacity: number;
}

/** Fixed visual constants for the canvas and every export format. */
export const MAP_STYLE: MapStyle = {
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  edgeWidth: 1,
  edgeDash: null,
  borderRadius: 12,
  shadowOpacity: 0.22,
};

export interface ContentBadge {
  icon: string;
  label: string;
}

/** Compact, human-readable summary of a node's rich content for the canvas. */
export function nodeBadges(content: NodeContent | undefined): ContentBadge[] {
  if (!content) return [];
  const out: ContentBadge[] = [];
  if (content.markdown) out.push({ icon: 'note', label: 'Note' });
  if (content.code.length) out.push({ icon: 'code', label: `${content.code.length} code` });
  if (content.formulas.length) out.push({ icon: 'brackets', label: `${content.formulas.length} ∑` });
  if (content.links.length) out.push({ icon: 'link', label: `${content.links.length} link${content.links.length === 1 ? '' : 's'}` });
  if (content.images.length) out.push({ icon: 'image', label: `${content.images.length} img` });
  if (content.checklist.length) {
    const done = content.checklist.filter((item) => item.done).length;
    out.push({ icon: done === content.checklist.length ? 'check' : 'list', label: `${done}/${content.checklist.length}` });
  }
  for (const tag of content.tags.slice(0, 2)) out.push({ icon: 'tag', label: `#${tag}` });
  return out.slice(0, 4);
}

export function badgeFingerprint(badges: ContentBadge[]): string {
  return badges.map((badge) => `${badge.icon}:${badge.label}`).join('|');
}

export function mapFontFamily(): string {
  return MAP_STYLE.fontFamily;
}

export function effectiveFontSize(node: MindNode, isRoot: boolean): number {
  return Math.round((node.style.fontSize + (isRoot ? 2 : 0)) * 10) / 10;
}

export function effectiveRadius(node: MindNode): number {
  return Math.round((node.style.borderRadius + MAP_STYLE.borderRadius) / 2);
}

export function effectiveEdgeWidth(level: number): number {
  const base = level === 1 ? 2.6 : level === 2 ? 2.1 : 1.7;
  return base * MAP_STYLE.edgeWidth;
}

/** Layout spacing is fixed too — no per-theme scaling. */
export function mapSpacing(layout: LayoutKind): { gapPrimary: number; gapSecondary: number } {
  const base: Record<LayoutKind, { gapPrimary: number; gapSecondary: number }> = {
    tree: { gapPrimary: 76, gapSecondary: 20 },
    horizontal: { gapPrimary: 70, gapSecondary: 18 },
    vertical: { gapPrimary: 58, gapSecondary: 26 },
    radial: { gapPrimary: 92, gapSecondary: 34 },
  };
  return base[layout];
}
