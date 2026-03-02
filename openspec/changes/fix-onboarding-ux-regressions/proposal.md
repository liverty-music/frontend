## Why

The onboarding artist discovery page has three UX issues:

1. **Complete button unresponsive on mobile** — The "ダッシュボードを生成する" button does not respond to taps. The canvas element underneath consumes click/touch events before they reach the button, and z-index hacks used for stacking are unreliable across Shadow DOM boundaries.
2. **z-index stacking violates project CSS standards** — The web-app-specialist skill explicitly rejects z-index stacking hacks. The current CSS uses z-index values (0, 15, 20, 30) for layer ordering, which should be replaced with DOM source order stacking.
3. **Bubbles not replenished after follow** — When a user taps a bubble, `getSimilarArtists()` returns artists that are all deduplicated against the existing pool, so no new bubbles spawn. The screen empties after each tap, preventing continued discovery beyond 3 follows.

## What Changes

- Remove all `z-index` declarations from `artist-discovery-page.css`; rely on DOM source order for stacking
- Reorder HTML elements in `artist-discovery-page.html` so that overlay elements (HUD, button) appear after the canvas in DOM order
- Fix the complete button's tap target so it receives pointer events on mobile (ensure canvas does not capture events in the button's area)
- Add a fallback bubble replenishment strategy in `dna-orb-canvas.ts`: when similar artists are fully deduplicated, reload a batch of random top artists to keep the canvas populated

## Capabilities

### New Capabilities

- `bubble-replenishment`: Fallback strategy to keep the discovery canvas populated when similar-artist deduplication empties the pool

### Modified Capabilities

- `onboarding-guidance`: Complete button must be tappable on mobile; z-index stacking replaced with DOM order

## Impact

- `src/routes/artist-discovery/artist-discovery-page.css` — Remove z-index, reorder stacking via DOM
- `src/routes/artist-discovery/artist-discovery-page.html` — Reorder elements for natural stacking
- `src/components/dna-orb/dna-orb-canvas.ts` — Add fallback replenishment when similar artists are exhausted
- `src/services/artist-discovery-service.ts` — May need a method to fetch replacement bubbles
