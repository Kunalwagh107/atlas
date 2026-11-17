import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(new URL('../../../public/404.js', import.meta.url), 'utf8');

function redirectTarget(hash: string): string {
  let target = '';
  runInNewContext(SCRIPT, {
    window: {
      location: {
        hash,
        replace(value: string) { target = value; },
      },
    },
  });
  return target;
}

describe('404 redirect', () => {
  it('sends unknown paths back to the app root', () => {
    expect(redirectTarget('')).toBe('/');
  });

  it('never forwards a fragment to the redirect target', () => {
    expect(redirectTarget('#section-2')).toBe('/');
    expect(redirectTarget('#bad hash')).toBe('/');
  });
});
