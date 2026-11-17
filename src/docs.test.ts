import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function doc(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

describe('documentation matches the implementation', () => {
  it('states the real Node requirement and HTTP-only dist', () => {
    const readme = doc('README.md');
    expect(readme).toContain('20.19+ or 22.12+');
    expect(readme).toContain('must be served over HTTP');
    expect(readme).not.toContain('Requires **Node 20 or newer**');
  });

  it('documents the storage fallback and image-export matrix', () => {
    const readme = doc('README.md');
    expect(readme).toContain('localStorage fallback');
    expect(readme).toContain('do\n  **not** include images');
    expect(readme).toContain('There are no external image URLs or remote image fetches');
  });

  it('documents the PWA shell and the portable map format', () => {
    const readme = doc('README.md');
    expect(readme).toContain('service worker');
    expect(readme).toContain('atlas-map');
    expect(readme).toContain('test:pwa');
  });

  it('keeps the strict CSP and the root-redirecting 404 in the build', () => {
    const headers = doc('public/_headers');
    const redirect = doc('public/404.js');
    expect(headers).toContain('Content-Security-Policy');
    expect(headers).toContain("script-src 'self'");
    expect(headers).toContain("frame-ancestors 'none'");
    // Unknown paths go back to the root and never forward a fragment.
    expect(redirect).toContain("window.location.replace('/')");
  });
});
