import { downloadBlob, safeFilename } from '../utils/common';

export async function renderSvgToCanvas(
  markup: string,
  width: number,
  height: number,
  maxScale = 2,
  background?: string,
): Promise<HTMLCanvasElement> {
  const scale = Math.max(1, Math.min(maxScale, 8000 / Math.max(width, height, 1)));
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG rasterisation failed'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(
  markup: string,
  width: number,
  height: number,
  filename: string,
  scale = 2,
  background?: string,
): Promise<void> {
  const canvas = await renderSvgToCanvas(markup, width, height, scale, background);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  downloadBlob(blob, `${safeFilename(filename)}.png`);
}
