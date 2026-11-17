import { downloadBlob, safeFilename } from '../utils/common';

/**
 * Minimal, dependency-free PDF writer: one or more landscape pages, each holding
 * a rasterised map tile as a JPEG XObject (/DCTDecode). Produces a real .pdf.
 */

export type PdfPageSize = 'a4' | 'letter';

export interface PdfPageImage {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

function pageDimensions(kind: PdfPageSize): { width: number; height: number } {
  return kind === 'letter'
    ? { width: 792, height: 612 }
    : { width: 842, height: 595 };
}

function buildPdf(pages: PdfPageImage[], pageSize: PdfPageSize): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const objectCount = 2 + pages.length * 3;
  const objectOffsets = new Array<number>(objectCount + 1).fill(0);

  const pushText = (text: string) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  const { width: pageWidth, height: pageHeight } = pageDimensions(pageSize);
  const margin = 26;
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');

  pushText('%PDF-1.4\n');

  objectOffsets[1] = offset;
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  objectOffsets[2] = offset;
  pushText(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, index) => {
    const pageObj = 3 + index * 3;
    const imageObj = pageObj + 1;
    const contentObj = pageObj + 2;
    const scale = Math.min(
      (pageWidth - margin * 2) / Math.max(1, page.pixelWidth),
      (pageHeight - margin * 2) / Math.max(1, page.pixelHeight),
    );
    const drawWidth = page.pixelWidth * scale;
    const drawHeight = page.pixelHeight * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const content = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const contentBytes = encoder.encode(content);

    objectOffsets[pageObj] = offset;
    pushText(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    );

    objectOffsets[imageObj] = offset;
    pushText(
      `${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    pushBytes(page.jpeg);
    pushText('\nendstream\nendobj\n');

    objectOffsets[contentObj] = offset;
    pushText(`${contentObj} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    pushText('endstream\nendobj\n');
  });

  const xrefOffset = offset;
  pushText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objectCount; i++) {
    pushText(`${String(objectOffsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): PdfPageImage {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const jpeg = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) jpeg[i] = binary.charCodeAt(i);
  return { jpeg, pixelWidth: canvas.width, pixelHeight: canvas.height };
}

export function exportPdf(
  canvas: HTMLCanvasElement,
  filename: string,
  options: { pageSize?: PdfPageSize } = {},
): void {
  const blob = buildPdf([canvasToJpeg(canvas)], options.pageSize ?? 'a4');
  downloadBlob(blob, `${safeFilename(filename)}.pdf`);
}

export function exportPdfPages(
  canvases: HTMLCanvasElement[],
  filename: string,
  options: { pageSize?: PdfPageSize } = {},
): void {
  if (!canvases.length) throw new Error('Nothing to export');
  const blob = buildPdf(canvases.map((canvas) => canvasToJpeg(canvas)), options.pageSize ?? 'a4');
  downloadBlob(blob, `${safeFilename(filename)}.pdf`);
}
