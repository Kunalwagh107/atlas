# Rehearsal: Atlas showcase hero

Gold: `figma` (canvas + selected object + cursor-driven change). Kept: one app window, a real canvas, a selected object, a single cursor gesture, a property/toolbar surface. Changed: Figma's layers/properties anatomy became Atlas's outline sidebar, branch-colored mind map, node toolbar and local-save status; the story is adding a child node, not changing a fill.

Beats: select Channels → open the node toolbar → add a child → type “Press kit” → commit and save → undo, returning to the opening frame. Loop ~11s.

Captured: widths 1440 and 390, wide and compact designs; still, 32-frame loop, state sheet; reduced motion covered by the poster. Look: Atlas light, indigo accent, branch palette from `src/styles/tokens.css`.

Gate:
- wide still: `rehearsal passed`
- wide loop: `rehearsal passed` (coverage inconclusive: sampling gaps)
- 390 still: `rehearsal passed`
- 390 loop: `rehearsal passed` (coverage inconclusive: sampling gaps)
- state sheet: `rehearsal passed`

Film lines reviewed:
- `lopsided: Press kit` — accepted; the node's icon/label group is left-aligned like every other branch node, with a little trailing room.
- `settle snap: span` — accepted as text content/width settling in the status and sidebar; no visible hop in the stills or contact sheets.
- `manual: same-box content change: atlas-edges` — intended: the new edge fades in on commit; inspected in the state sheet.
- `near-tangent: node/toolbar` (compact) — accepted after moving the toolbar; the remaining 2px report is the toolbar's shadow edge, not a control collision.
- `incomplete: sampling gaps` — the film harness could not judge motion between samples; the loop was watched at speed and in the state sheet.

Review: hero copy leads, the product window is the single focal object, the branch colors carry the map's identity, and the save status is the payoff. The compact design keeps the same action and result, not a squeezed wide scene.

Assumptions: the showcase is a product page, not a replacement for the app; “Open Atlas”/“Start mapping” lead to `/`. The faux UI is not interactive by design and is exposed to assistive tech as one labelled image.

Not checked: real Safari/Firefox rendering of the Stage; a live Cloudflare deployment (no credentials). These are listed in the final report.
