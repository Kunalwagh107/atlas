import type { Palette } from '../core/mindmap/palette';
import type { Viewport } from '../state/types';

export interface ViewExportScene {
  svg: SVGSVGElement;
  viewport: Viewport;
  width: number;
  height: number;
  palette: Palette;
  includeGrid?: boolean;
  fontFamily?: string;
  /** imageId → data URL, used to replace local object URLs in the clone. */
  imageSources?: Record<string, string>;
}

/**
 * "Current view" export: clones the live scene graph but keeps its viewport
 * transform, so the result is exactly what is on screen. The programmatic
 * `renderExportScene` is used for whole-map / complete-map output instead.
 */
export function buildViewSvg(scene: ViewExportScene): { markup: string; width: number; height: number } {
  const { svg, palette, width, height, includeGrid } = scene;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  const family = scene.fontFamily ?? "'Inter', 'Segoe UI', system-ui, sans-serif";
  clone.setAttribute('font-family', family);

  clone.querySelectorAll('[data-export-ignore]').forEach((element) => element.remove());
  clone.querySelectorAll('.canvas-hit').forEach((element) => element.remove());
  // Live nodes render blobs through object URLs; a standalone SVG needs bytes.
  if (scene.imageSources) {
    clone.querySelectorAll('image[data-image-id]').forEach((element) => {
      const id = element.getAttribute('data-image-id') ?? '';
      const source = scene.imageSources?.[id];
      if (!source) return;
      element.setAttribute('href', source);
      element.setAttribute('xlink:href', source);
    });
  }

  const sceneGroup = clone.querySelector('[data-scene]');
  if (sceneGroup) {
    sceneGroup.removeAttribute('style');
    sceneGroup.removeAttribute('class');
  }

  const ns = 'http://www.w3.org/2000/svg';
  const background = document.createElementNS(ns, 'rect');
  background.setAttribute('x', '0');
  background.setAttribute('y', '0');
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('fill', palette.canvasBg);
  clone.insertBefore(background, clone.firstChild);

  if (includeGrid) {
    const defs = clone.querySelector('defs') ?? clone.insertBefore(document.createElementNS(ns, 'defs'), clone.firstChild);
    const pattern = document.createElementNS(ns, 'pattern');
    pattern.setAttribute('id', 'atlas-export-grid');
    pattern.setAttribute('width', String(24 * scene.viewport.zoom));
    pattern.setAttribute('height', String(24 * scene.viewport.zoom));
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', '1');
    dot.setAttribute('cy', '1');
    dot.setAttribute('r', '1');
    dot.setAttribute('fill', palette.gridDot);
    pattern.appendChild(dot);
    defs.appendChild(pattern);
    const gridRect = document.createElementNS(ns, 'rect');
    gridRect.setAttribute('x', '0');
    gridRect.setAttribute('y', '0');
    gridRect.setAttribute('width', String(width));
    gridRect.setAttribute('height', String(height));
    gridRect.setAttribute('fill', 'url(#atlas-export-grid)');
    clone.insertBefore(gridRect, background.nextSibling);
  }

  const style = document.createElementNS(ns, 'style');
  // Set on <svg> so per-level font-family attributes on <text> still win.
  style.textContent = `svg { font-family: ${family}; }`;
  clone.insertBefore(style, clone.firstChild);

  const metadata = document.createElementNS(ns, 'title');
  metadata.textContent = 'Atlas — current view';
  clone.insertBefore(metadata, clone.firstChild);

  const markup = new XMLSerializer().serializeToString(clone);
  return {
    markup: `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`,
    width,
    height,
  };
}
