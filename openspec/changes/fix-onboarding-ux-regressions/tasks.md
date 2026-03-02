## 1. Remove z-index and fix stacking via DOM order

- [x] 1.1 Remove all `z-index` declarations from `artist-discovery-page.css`
- [x] 1.2 Remove `z-index: 0` from `.container::before` (pseudo-elements paint before children naturally)
- [x] 1.3 Reorder HTML in `artist-discovery-page.html`: place `<dna-orb-canvas>` first, then overlay elements (HUD, orb-label, button) after it in DOM order
- [x] 1.4 Verify overlay elements paint above canvas without z-index

## 2. Fix complete button tap target

- [x] 2.1 Add `pointer-events: none` to the overlay wrapper div (so canvas receives bubble taps through it)
- [x] 2.2 Add `pointer-events: auto` to the complete button element (so it captures taps in its area)
- [x] 2.3 Ensure onboarding HUD stays `pointer-events: none` (non-interactive, purely visual)
- [x] 2.4 Verify button responds to tap/click on mobile and desktop

## 3. Bubble replenishment fallback

- [x] 3.1 Add `loadReplacementBubbles()` method to `ArtistDiscoveryService` that calls `ListTop`, filters against seen artists, and returns fresh bubbles
- [x] 3.2 In `dna-orb-canvas.ts` `handleInteraction()`, call `loadReplacementBubbles()` when `getSimilarArtists()` returns empty
- [x] 3.3 Spawn replacement bubbles near the absorption point, same as similar artists
- [x] 3.4 Verify canvas stays populated after following artists during onboarding

## 4. Verify end-to-end

- [x] 4.1 Test full onboarding flow on mobile viewport: tap 3 bubbles, dots fill, button appears, button is tappable, navigates to loading
- [x] 4.2 Test that bubbles replenish after each follow (canvas never empties until pool is truly exhausted)
- [x] 4.3 Confirm no `z-index` present in `artist-discovery-page.css`
