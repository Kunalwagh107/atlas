import { computeLayout } from '../core/layout';
import { FILE_EXTENSIONS, serializeDocument } from '../core/mindmap/codecs';
import type { MindMapDocument, Rect } from '../core/mindmap/types';
import { hydrateDocumentImages } from '../persistence/imageBlobs';
import type { DerivedMap } from '../state/derived';
import { store } from '../state/store';
import { clamp, downloadBlob, safeFilename } from '../utils/common';
import { exportPdf, exportPdfPages, type PdfPageSize } from './pdf';
import { serializePortableMap } from './portable';
import { renderSvgToCanvas } from './png';
import { renderExportScene, type ExportSceneSpec } from './scene';
import { buildViewSvg } from './svg';

export type ExportFormat = 'json' | 'svg' | 'png' | 'pdf' | 'markdown' | 'opml' | 'csv' | 'freemind';
export type ExportScope = 'visible' | 'complete';
export type ExportArea = 'whole' | 'view';
export type PdfMode = 'fit' | 'multipage';

export interface ExportOptions {
  scale?: number;
  includeGrid?: boolean;
  padding?: number;
  /** visible = current collapse state; complete = every node, laid out as if expanded. */
  scope?: ExportScope;
  /** whole = full scene; view = exactly what is on screen right now. */
  area?: ExportArea;
  pdfMode?: PdfMode;
  pageSize?: PdfPageSize;
}

function isTextFormat(format: ExportFormat): format is 'markdown' | 'opml' | 'csv' | 'freemind' {
  return format === 'markdown' || format === 'opml' || format === 'csv' || format === 'freemind';
}

function requireDoc(derived: DerivedMap): MindMapDocument {
  if (!derived.doc) throw new Error('Open a map before exporting');
  return derived.doc;
}

function sceneSpec(
  derived: DerivedMap,
  options: ExportOptions,
  imageSources: Record<string, string>,
): ExportSceneSpec & { ids: string[] } {
  const doc = requireDoc(derived);
  const ids = options.scope === 'complete' ? Object.keys(doc.nodes) : derived.visibleIds;
  const positions = options.scope === 'complete'
    ? computeLayout(doc, derived.sizes, doc.settings.layout, { ignoreCollapsed: true })
    : derived.positions;
  return {
    doc,
    ids,
    positions,
    sizes: derived.sizes,
    palette: derived.palette,
    mapStyle: derived.mapStyle,
    imageSources,
    padding: options.padding ?? 64,
    includeGrid: options.includeGrid ?? false,
  };
}

/** Tile a large scene into overlapping page-sized rectangles. */
function pageTiles(width: number, height: number): Rect[] {
  const cols = clamp(Math.ceil(width / 1800), 1, 3);
  const rows = clamp(Math.ceil(height / 1200), 1, 4);
  const tileW = width / cols;
  const tileH = height / rows;
  const overlap = 40;
  const tiles: Rect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.max(0, col * tileW - overlap);
      const y = Math.max(0, row * tileH - overlap);
      tiles.push({
        x,
        y,
        width: Math.min(width - x, tileW + overlap * 2),
        height: Math.min(height - y, tileH + overlap * 2),
      });
    }
  }
  return tiles;
}

export async function exportMap(
  format: ExportFormat,
  derived: DerivedMap,
  options: ExportOptions = {},
): Promise<void> {
  const liveDoc = requireDoc(derived);
  // Rendered exports need embedded bytes (blob:/object URLs do not survive a
  // standalone SVG file). JSON becomes fully portable for the same reason.
  const { doc, sources: imageSources } = await hydrateDocumentImages(liveDoc);

  if (format === 'json') {
    downloadBlob(
      new Blob([serializePortableMap(doc)], { type: 'application/json;charset=utf-8' }),
      `${safeFilename(doc.title)}.json`,
    );
    return;
  }

  if (isTextFormat(format)) {
    const mime = format === 'opml' || format === 'freemind'
      ? 'application/xml;charset=utf-8'
      : format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
    downloadBlob(
      new Blob([serializeDocument(doc, format)], { type: mime }),
      `${safeFilename(doc.title)}.${FILE_EXTENSIONS[format]}`,
    );
    return;
  }

  const scale = options.scale ?? 2;
  const area = options.area ?? 'whole';
  let markup: string;
  let width: number;
  let height: number;

  if (area === 'view') {
    const svg = document.querySelector<SVGSVGElement>('.canvas-svg');
    if (!svg) throw new Error('Canvas is not ready for export');
    const state = store.getState();
    const view = buildViewSvg({
      svg,
      viewport: state.viewport,
      width: state.ui.canvasSize.width,
      height: state.ui.canvasSize.height,
      palette: derived.palette,
      includeGrid: options.includeGrid ?? false,
      fontFamily: derived.mapStyle.fontFamily,
      imageSources,
    });
    markup = view.markup;
    width = view.width;
    height = view.height;
  } else {
    const rendered = renderExportScene(sceneSpec(derived, options, imageSources));
    markup = rendered.markup;
    width = rendered.width;
    height = rendered.height;
  }

  if (format === 'svg') {
    downloadBlob(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), `${safeFilename(doc.title)}.svg`);
    return;
  }

  if (format === 'pdf' && options.pdfMode === 'multipage' && area !== 'view') {
    const spec = sceneSpec(derived, options, imageSources);
    const full = renderExportScene(spec);
    const canvases: HTMLCanvasElement[] = [];
    for (const tile of pageTiles(full.width, full.height)) {
      const page = renderExportScene({ ...spec, clip: tile });
      canvases.push(await renderSvgToCanvas(page.markup, page.width, page.height, Math.min(scale, 2), derived.palette.canvasBg));
    }
    exportPdfPages(canvases, doc.title, { pageSize: options.pageSize ?? 'a4' });
    return;
  }

  const canvas = await renderSvgToCanvas(markup, width, height, scale, derived.palette.canvasBg);
  if (format === 'png') {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    downloadBlob(blob, `${safeFilename(doc.title)}.png`);
    return;
  }
  exportPdf(canvas, doc.title, { pageSize: options.pageSize ?? 'a4' });
}

export { documentToJson } from './json';
export type { PdfPageSize } from './pdf';
