## Context

The artist discovery page uses a full-viewport `<canvas>` element inside a Shadow DOM custom element (`dna-orb-canvas`). The canvas has `position: absolute; inset: 0` and registers `click` + `touchstart` event listeners. Overlay elements (onboarding HUD, complete button, orb label) are siblings of the canvas in the parent Shadow DOM and rely on `z-index` for stacking — which violates the project's CSS standards (web-app-specialist skill rejects z-index stacking hacks).

On mobile, the canvas captures all touch events before they reach the complete button, making it unresponsive. Additionally, when a user follows an artist, `getSimilarArtists()` often returns artists that are fully deduplicated against the `seenArtistNames/Ids/Mbids` sets, causing no new bubbles to spawn and the canvas to empty.

## Goals / Non-Goals

**Goals:**
- Complete button must be tappable on all devices (desktop and mobile)
- Remove all `z-index` declarations; use DOM source order for stacking
- Keep the canvas populated after each follow so users can discover beyond 3 artists
- Maintain existing visual design (cosmic HUD, orbital dots, translucent pill)

**Non-Goals:**
- Redesigning the bubble physics or absorption animation
- Changing the ListSimilar API behavior on the backend
- Fixing the ListSimilar deduplication logic itself (that's a backend concern)

## Decisions

### 1. Canvas pointer-events passthrough for overlay zones

**Decision**: Add `pointer-events: none` to the canvas element, then re-enable `pointer-events: auto` only on the canvas via JavaScript for bubble areas. Alternatively, use CSS `pointer-events: none` on the canvas in the button zone.

**Rejected approach**: The simpler approach is to keep the canvas click handler but add a coordinate check — if the click falls within the button's bounding rect, ignore it and let the event propagate. However, this tightly couples the canvas to the button layout.

**Chosen approach**: Use `pointer-events: none` on the `dna-orb-canvas` host element from the parent CSS, and instead handle pointer events at the `.container` level, delegating to the canvas via `elementsFromPoint()`. This is fragile with Shadow DOM.

**Final approach**: The most robust solution is to **move overlay elements (HUD, button, orb-label) outside the canvas stacking context** by placing them in a separate overlay `<div>` that is a sibling of `dna-orb-canvas`, and ensure this overlay div has `pointer-events: none` with `pointer-events: auto` only on interactive children (the button). DOM order ensures the overlay div paints on top of the canvas. No z-index needed.

```
<div class="container">          ← position: relative
  <dna-orb-canvas />              ← paints first (behind)
  <div class="overlay">           ← paints second (on top), pointer-events: none
    <div class="onboarding-hud">  ← pointer-events: none (non-interactive)
    <div class="orb-label">       ← pointer-events: none
    <button class="complete-button"> ← pointer-events: auto (interactive)
  </div>
</div>
```

### 2. Remove z-index entirely

**Decision**: Remove all `z-index` from `.container::before`, `.onboarding-hud`, `.complete-button-wrapper`, and `.orb-label`. Stacking is controlled by:
- `.container::before` (pseudo-element, paints before children)
- `<dna-orb-canvas>` (first child, paints first)
- Overlay elements (later in DOM, paint on top)

### 3. Bubble replenishment fallback

**Decision**: When `getSimilarArtists()` returns zero new bubbles (all deduplicated), fall back to calling `loadInitialArtists()` again but filter against the `seenArtistIds` set. This reloads the top-50 artist pool and any unseen artists become new bubbles.

**Why not a new API?**: Adding a "random artists" endpoint would be ideal long-term, but the existing `ListTop` RPC already returns 50 artists. On second and subsequent calls, many will be seen, but some new ones may appear due to popularity changes. This is a pragmatic client-side fallback.

**Implementation**: In `dna-orb-canvas.ts`, after `getSimilarArtists()` returns an empty array, call `discoveryService.loadReplacementBubbles()` — a new method that calls `ListTop` and filters against seen artists, returning only fresh ones.

## Risks / Trade-offs

- **[Risk] Replacement bubbles may also be empty** — If the user has seen all 50 top artists, the fallback produces nothing. → Mitigation: Accept this gracefully; the user has explored the full initial pool and the complete button is already available.
- **[Risk] DOM order stacking may break if elements are conditionally rendered** — `if.bind` removes elements from DOM, changing paint order. → Mitigation: Use `show.bind` instead of `if.bind` for the overlay container so it stays in DOM.
- **[Risk] Canvas touchstart with `passive: true` cannot call preventDefault** — The touch event on the canvas propagates to the button area. → Mitigation: The overlay structure with `pointer-events: none` on the canvas's host element in the button zone handles this naturally since the button is a separate DOM tree.
