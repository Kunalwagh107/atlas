import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import type { MeasuredNode } from '../core/layout/measure';
import { MAP_STYLE } from '../core/mindmap/appearance';
import type { Palette } from '../core/mindmap/palette';
import type { MindMapDocument, Point } from '../core/mindmap/types';
import { clamp, downloadBlob, safeFilename } from '../utils/common';
import { computeBounds } from '../core/layout';
import { renderExportScene, type ExportSceneSpec } from './scene';

/**
 * Presentation → animated GIF, entirely in the browser.
 *
 * Frames are rasterised from the *same* scene renderer the SVG/PNG/PDF exporters
 * use, so the GIF keeps the map's real appearance: branch-coloured curved
 * connectors, node radii, shadows, icons, descriptions and badges. A hand-drawn
 * canvas approximation drifted from the app as soon as the style changed.
 *
 * The base scene is rendered and decoded once; each frame only rasterises the
 * active node and its ancestor chain, which keeps a 60-frame export cheap.
 */

export const MAX_GIF_FRAMES = 60;
export const GIF_WIDTH_CHOICES = [480, 800, 1280] as const;
export const GIF_SPEED_CHOICES = [500, 1000, 2000] as const;
export type GifQuality = 'fast' | 'balanced' | 'best';
export const GIF_QUALITY_COLORS: Record<GifQuality, number> = { fast: 32, balanced: 96, best: 256 };

/** Keep a single frame small and the whole export bounded (~45M pixels total). */
const MAX_PIXELS_PER_FRAME = 1_100_000;
const MAX_TOTAL_PIXELS = 45_000_000;
const BASE_ALPHA = 0.34;

export class GifExportCancelled extends Error {
  constructor() {
    super('GIF export cancelled');
    this.name = 'GifExportCancelled';
  }
}

export interface GifPresentationSource {
  doc: MindMapDocument;
  order: string[];
  positions: Record<string, Point>;
  sizes: Record<string, MeasuredNode>;
  visibleIds: string[];
  palette: Palette;
  branchIndices: Record<string, number>;
  imageSources?: Record<string, string>;
}

export interface GifExportOptions {
  width: number;
  quality: GifQuality;
  frameDelayMs: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface GifExportResult {
  frames: number;
  width: number;
  height: number;
  bytes: number;
  /** True when the presentation had more steps than MAX_GIF_FRAMES. */
  sampled: boolean;
}

/** Even sampling keeps the whole storyline when a deck is longer than the cap. */
export function frameIndices(total: number, max = MAX_GIF_FRAMES): number[] {
  if (total <= 0) return [];
  if (total <= max) return Array.from({ length: total }, (_, index) => index);
  return Array.from({ length: max }, (_, index) => Math.round((index * (total - 1)) / (max - 1)));
}

/** The active node plus every ancestor, so the highlighted path reads as a trail. */
export function highlightPath(doc: MindMapDocument, activeId: string | null): string[] {
  if (!activeId || !doc.nodes[activeId]) return [];
  const out: string[] = [];
  let cursor: string | null = activeId;
  let guard = 0;
  while (cursor && guard++ < 5000) {
    out.push(cursor);
    cursor = doc.nodes[cursor]?.parentId ?? null;
  }
  return out;
}

/** Yield to the event loop so progress renders and cancel clicks are delivered. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function rasterize(markup: string): Promise<HTMLImageElement> {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This browser could not rasterise the map for GIF export'));
      image.src = url;
    });
    return image;
  } finally {
    // The decoded image keeps its pixels; the URL is only needed until load.
    URL.revokeObjectURL(url);
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function drawChrome(
  ctx: CanvasRenderingContext2D,
  doc: MindMapDocument,
  palette: Palette,
  width: number,
  height: number,
  activeTitle: string,
  step: number,
  total: number,
): void {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = palette.nodeText;
  ctx.font = `600 13px ${MAP_STYLE.fontFamily}`;
  ctx.fillText(fitText(ctx, doc.title, width * 0.6), 18, 20);
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.nodeMuted;
  ctx.font = `400 12px ${MAP_STYLE.fontFamily}`;
  ctx.fillText(`${step} / ${total}`, width - 18, 20);

  // Progress rule under the header, so the GIF reads as a sequence.
  const ruleY = 34;
  ctx.fillStyle = palette.nodeBorder;
  ctx.fillRect(18, ruleY, width - 36, 2);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(18, ruleY, Math.max(2, ((width - 36) * step) / Math.max(1, total)), 2);

  ctx.textAlign = 'left';
  ctx.fillStyle = palette.accent;
  ctx.font = `600 12px ${MAP_STYLE.fontFamily}`;
  ctx.fillText(fitText(ctx, activeTitle, width - 36), 18, height - 16);
  ctx.restore();
}

export async function exportPresentationGif(
  source: GifPresentationSource,
  options: GifExportOptions,
): Promise<GifExportResult> {
  const indices = frameIndices(source.order.length);
  if (!indices.length) throw new Error('This presentation has no steps to export.');

  const { doc, positions, sizes, palette } = source;
  const ids = source.visibleIds.length ? source.visibleIds : Object.keys(doc.nodes);
  // One camera for every frame: bounds are computed once and passed to each render.
  const bounds = computeBounds(positions, sizes, ids, 56);
  const scene: ExportSceneSpec = {
    doc,
    ids,
    positions,
    sizes,
    palette,
    mapStyle: MAP_STYLE,
    includeGrid: false,
    bounds,
    imageSources: source.imageSources,
  };
  const worldW = Math.max(1, bounds.width);
  const worldH = Math.max(1, bounds.height);

  const HEADER = 46;
  const FOOTER = 32;
  const PAD = 16;
  let width = clamp(Math.round(options.width), 240, 1600);
  const chrome = HEADER + FOOTER;
  const naturalHeight = ((width - PAD * 2) * worldH) / worldW + chrome + PAD;
  let height = clamp(Math.round(naturalHeight), 180, 1600);

  // Hard budget: a huge deck must not allocate gigabytes of RGBA + LZW buffers.
  const perFrame = Math.sqrt(MAX_PIXELS_PER_FRAME / (width * height));
  const overall = Math.sqrt(MAX_TOTAL_PIXELS / (width * height * indices.length));
  const shrink = Math.min(1, perFrame, overall);
  if (shrink < 1) {
    width = Math.max(240, Math.round(width * shrink));
    height = Math.max(160, Math.round(height * shrink));
  }

  const area = {
    x: PAD,
    y: HEADER,
    width: Math.max(1, width - PAD * 2),
    height: Math.max(1, height - HEADER - FOOTER),
  };
  const scale = Math.min(area.width / worldW, area.height / worldH);
  const drawW = worldW * scale;
  const drawH = worldH * scale;
  const dx = area.x + (area.width - drawW) / 2;
  const dy = area.y + (area.height - drawH) / 2;
  // Rasterise the SVG close to its final pixel size so text stays crisp.
  const pixelScale = clamp(scale, 0.1, 3);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot create a 2D canvas for GIF export.');

  const baseImage = await rasterize(renderExportScene({ ...scene, pixelScale }).markup);
  if (options.signal?.aborted) throw new GifExportCancelled();

  const colors = GIF_QUALITY_COLORS[options.quality] ?? GIF_QUALITY_COLORS.balanced;
  const delay = clamp(Math.round(options.frameDelayMs), 100, 10_000);
  const gif = GIFEncoder();

  for (let frame = 0; frame < indices.length; frame++) {
    if (options.signal?.aborted) throw new GifExportCancelled();
    const activeId = source.order[indices[frame]] ?? null;
    const highlight = highlightPath(doc, activeId);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.canvasBg;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = BASE_ALPHA;
    ctx.drawImage(baseImage, dx, dy, drawW, drawH);
    ctx.globalAlpha = 1;
    if (highlight.length) {
      // Only the active node and its ancestry, drawn at full strength on top.
      const overlay = renderExportScene({
        ...scene,
        ids: highlight,
        bounds,
        pixelScale,
        transparent: true,
      });
      const overlayImage = await rasterize(overlay.markup);
      ctx.drawImage(overlayImage, dx, dy, drawW, drawH);
    }
    const activeTitle = activeId ? doc.nodes[activeId]?.title ?? doc.title : doc.title;
    drawChrome(ctx, doc, palette, width, height, activeTitle, frame + 1, indices.length);
    ctx.restore();

    const rgba = ctx.getImageData(0, 0, width, height).data;
    const paletteColors = quantize(rgba, colors);
    const indexed = applyPalette(rgba, paletteColors);
    gif.writeFrame(indexed, width, height, {
      palette: paletteColors,
      delay,
      ...(frame === 0 ? { repeat: 0 } : {}),
    });
    options.onProgress?.(frame + 1, indices.length);
    // One frame per macrotask keeps the main thread responsive on large decks.
    await nextTick();
  }
  if (options.signal?.aborted) throw new GifExportCancelled();
  gif.finish();
  const bytes = gif.bytes();
  const filename = `${safeFilename(doc.title)}-presentation.gif`;
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'image/gif' }), filename);
  return {
    frames: indices.length,
    width,
    height,
    bytes: bytes.length,
    sampled: indices.length < source.order.length,
  };
}
