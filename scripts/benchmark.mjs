/**
 * Deterministic, dependency-free performance harness — OFFLINE / Node + Vite SSR.
 *
 * Loads the TypeScript source through Vite's SSR module loader (so no extra
 * build step or ts-node is needed), exercises the real production code paths at
 * 100 / 500 / 1k / 2.5k / 5k nodes, and refreshes the offline section of
 * BENCHMARKS.md. These are pure compute / reducer-input numbers: they do not
 * include a browser, layout, paint, compositing or event dispatch, so they
 * cannot establish UI responsiveness. For real-browser measurements run
 * `node scripts/browser-benchmark.mjs` (appended to BENCHMARKS.md under a
 * clearly marked section).
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const SIZES = [100, 500, 1000, 2500, 5000];

// MEDIAN POLICY: every timing below uses an ODD number of iterations so the
// middle sample is a true median. The old harness used 2 iterations, for which
// samples[Math.floor(2 / 2)] === samples[1] is the SLOWER run, not a median.
const ITERATIONS = 11;
// A handful of measurements are too costly to repeat 11 times at every size.
// They keep a fixed count, stated explicitly in the generated report:
const SCENE_ITERATIONS = 1; // full-map SVG scene string build
const DERIVED_COLD_ITERATIONS = 1; // cold derived-context build (state reset)
const DERIVED_TYPING_ITERATIONS = 5; // incremental derived rebuild after one edit
const DRAG_FRAMES = 60; // DRAG_MOVE reducer calls; reported as mean per frame

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

/** Median of `iterations` samples. With an odd count this is the exact middle
 * sample after sorting; all callers here pass odd counts. */
function median(fn, iterations = ITERATIONS) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

function ms(value) {
  return `${value.toFixed(1)} ms`;
}

try {
  const fixtures = await server.ssrLoadModule('/src/test/fixtures.ts');
  const measure = await server.ssrLoadModule('/src/core/layout/measure.ts');
  const layout = await server.ssrLoadModule('/src/core/layout/index.ts');
  const validation = await server.ssrLoadModule('/src/core/mindmap/validation.ts');
  const search = await server.ssrLoadModule('/src/core/mindmap/search.ts');
  const json = await server.ssrLoadModule('/src/export/json.ts');
  const scene = await server.ssrLoadModule('/src/export/scene.ts');
  const appearance = await server.ssrLoadModule('/src/core/mindmap/appearance.ts');
  const paletteModule = await server.ssrLoadModule('/src/core/mindmap/palette.ts');
  const storeModule = await server.ssrLoadModule('/src/state/store.ts');
  const derivedModule = await server.ssrLoadModule('/src/state/derivedData.ts');

  const palette = paletteModule.getPalette('light');
  const mapStyle = appearance.MAP_STYLE;
  const rows = [];

  for (const size of SIZES) {
    let doc;
    const build = median(() => { doc = fixtures.makeLargeDoc(size); });
    const nodes = Object.values(doc.nodes);

    const measureTime = median(() => measure.measureAll(nodes, true, doc.rootId));
    const sizes = measure.measureAll(nodes, true, doc.rootId);
    measure.clearMeasureCache();

    const layoutTime = median(() => layout.computeLayout(doc, sizes, 'tree', { ignoreCollapsed: true }));
    const positions = layout.computeLayout(doc, sizes, 'tree', { ignoreCollapsed: true });
    const validateTime = median(() => validation.parseDocument(doc));
    const searchTime = median(() => search.searchDocument(doc, 'Node', search.DEFAULT_SEARCH_FILTERS));
    const jsonTime = median(() => json.documentToJson(doc));
    const sceneTime = median(() => scene.renderExportScene({
      doc,
      ids: Object.keys(doc.nodes),
      positions,
      sizes,
      palette,
      mapStyle,
      padding: 64,
    }), SCENE_ITERATIONS);

    // Derived context: cold build (open a map) versus a typing edit (one node
    // replaced). The incremental path must not re-scan the whole map.
    derivedModule.resetDerivedCache();
    const derivedCold = median(() => {
      derivedModule.resetDerivedCache();
      derivedModule.buildDerived(doc, 'light', null);
    }, DERIVED_COLD_ITERATIONS);
    let typingDoc = doc;
    const typingId = Object.keys(doc.nodes)[10] ?? doc.rootId;
    const derivedTyping = median(() => {
      const node = typingDoc.nodes[typingId] ?? doc.nodes[typingId];
      typingDoc = {
        ...typingDoc,
        nodes: { ...typingDoc.nodes, [typingId]: { ...node, title: `${node.title}${Math.random().toString(36).slice(2, 4)}` } },
      };
      derivedModule.buildDerived(typingDoc, 'light', null);
    }, DERIVED_TYPING_ITERATIONS);

    // Interactive drag path: DRAG_MOVE must be O(1) now that history.present is
    // untouched until pointerup. This is the regression guard for the hot path.
    let dragState = storeModule.reducer(storeModule.createInitialState(), { type: 'LOAD', doc });
    dragState = storeModule.reducer(dragState, { type: 'BEGIN_DRAG', label: 'Move nodes' });
    const dragId = Object.keys(doc.nodes)[10] ?? doc.rootId;
    const dragStart = performance.now();
    for (let frame = 0; frame < DRAG_FRAMES; frame++) {
      dragState = storeModule.reducer(dragState, { type: 'DRAG_MOVE', positions: { [dragId]: { x: frame, y: frame } } });
    }
    const dragFrameTime = (performance.now() - dragStart) / DRAG_FRAMES;
    storeModule.reducer(dragState, { type: 'END_DRAG' });

    rows.push({ size: Object.keys(doc.nodes).length, build, measureTime, layoutTime, validateTime, searchTime, jsonTime, sceneTime, derivedCold, derivedTyping, dragFrameTime });
    console.log(`${String(size).padStart(5)} nodes  layout ${ms(layoutTime)}  validate ${ms(validateTime)}  scene ${ms(sceneTime)}  derived cold ${ms(derivedCold)}  typing ${ms(derivedTyping)}  drag/frame ${ms(dragFrameTime)}`);
  }

  const table = [
    '| Nodes | Build doc | Measure | Layout | Validate | Search | JSON | SVG scene | Derived cold | Derived typing | Drag frame |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row.size} | ${ms(row.build)} | ${ms(row.measureTime)} | ${ms(row.layoutTime)} | ${ms(row.validateTime)} | ${ms(row.searchTime)} | ${ms(row.jsonTime)} | ${ms(row.sceneTime)} | ${ms(row.derivedCold)} | ${ms(row.derivedTyping)} | ${ms(row.dragFrameTime)} |`),
  ].join('\n');

  const fastest = rows[0];
  const slowest = rows[rows.length - 1];
  const doc = [
    '# Atlas performance benchmarks',
    '',
    `Offline section generated by \`npm run bench\` on ${new Date().toISOString().slice(0, 10)} · Node ${process.version} · ${ITERATIONS}-run median (SVG scene & derived cold: ${SCENE_ITERATIONS} run; derived typing: ${DERIVED_TYPING_ITERATIONS}-run median; drag: mean of ${DRAG_FRAMES} frames).`,
    '',
    '## Scope: offline Node / Vite SSR',
    '',
    'Harness: `scripts/benchmark.mjs` loads the production TypeScript modules through Vite SSR and generates',
    'a balanced tree with three children per node. Text measurement uses the deterministic non-DOM fallback,',
    'so numbers are comparable across machines but slightly conservative versus a real browser canvas.',
    '',
    'These timings measure pure computation — document building, text measurement, layout, validation, JSON/SVG',
    'string building and the store reducer. They deliberately exclude browser layout, paint, compositing, event',
    'dispatch and network. **They are not a measure of UI responsiveness.** For end-to-end Chromium numbers',
    '(import → rendered nodes, typing latency, pointer-drag frame times) run `node scripts/browser-benchmark.mjs`;',
    'the results are appended to a clearly marked real-browser section below.',
    '',
    table,
    '',
    '## Observations (offline)',
    '',
    `- Layout stays close to linear: ${ms(fastest.layoutTime)} at ${fastest.size} nodes versus ${ms(slowest.layoutTime)} at ${slowest.size} nodes.`,
    `- Full-map SVG scene construction at ${slowest.size} nodes takes ${ms(slowest.sceneTime)}. Browser rasterisation, not string building, dominates a real PNG/PDF export.`,
    '- Validation (`parseDocument`) and export scene generation each had an O(n²) pass (per-parent `getChildren` scans and per-node `branchIndexOf`). Both were replaced by single-pass BFS/grouping; this table is the regression guard.',
    '- Search is a linear scan with a small constant; results are ranked and shared by the canvas, outline and search panel.',
    '- The canvas only renders nodes intersecting the viewport. Edge/toolbar/guide scans are still O(visible nodes) per frame, but node DOM is bounded and the minimap now emits at most one path per branch colour.',
    `- Reducer-only DRAG_MOVE cost: mean ${ms(fastest.dragFrameTime)}/frame at ${fastest.size} nodes versus ${ms(slowest.dragFrameTime)}/frame at ${slowest.size} nodes (mean of ${DRAG_FRAMES} reducer calls). This isolates store work from rendering; it is NOT an interaction frame rate. Values below 0.05 ms display as \`0.0 ms\` — that rounding is not evidence that rendering or input is free.`,
    `- Derived context: a cold build costs ${ms(slowest.derivedCold)} at ${slowest.size} nodes, while a typing edit costs ${ms(slowest.derivedTyping)}. The incremental path reuses the structural slice, positions and every unchanged measurement; only the edited node is re-measured and the bounds are recomputed.`,
    '',
    '## Remaining debt',
    '',
    'Cross-tab writes are no longer last-write-wins: each save publishes a revision and a tab with a newer revision blocks the write, warns, and offers a recovery copy. The share link is still a base64 blob capped at 60 KB.',
    '',
  ].join('\n');

  writeFileSync(new URL('../BENCHMARKS.md', import.meta.url), doc, 'utf8');
  console.log('\nBENCHMARKS.md offline section refreshed.');
} finally {
  await server.close();
}
