import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emit `sw.js` with the real hashed asset names for this build. A static file in
 * public/ cannot know those names, and precaching only the HTML would leave the
 * first offline hard reload without its JS/CSS.
 */
function atlasServiceWorker(): Plugin {
  return {
    name: 'atlas-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((name) => /\.(?:js|css|svg|png|webp|woff2?)$/i.test(name))
        .sort();
      const assets = [...new Set([
        './',
        './index.html',
        './showcase.html',
        './404.html',
        './404.js',
        './favicon.svg',
        './manifest.webmanifest',
        ...built.map((name) => `./${name.replace(/\\/g, '/')}`),
      ])];
      const version = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./src/pwa/sw-template.js', import.meta.url), 'utf8');
      const source = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(assets, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative asset paths keep the build portable under a Pages path prefix.
  base: './',
  plugins: [react(), atlasServiceWorker()],
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        showcase: 'showcase.html',
      },
    },
  },
});
