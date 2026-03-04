## Context

After Phase 1 (`unify-discover-page`), the unified `DiscoverPage` still delegates to `ArtistDiscoveryService` which holds both data access logic and UI state. The `dna-orb-canvas` component directly injects this service to read `availableBubbles`, `orbIntensity`, and call `getSimilarArtists()` / `evictOldest()`. This tight coupling makes the canvas component untestable in isolation and creates bidirectional data flow.

## Goals / Non-Goals

**Goals:**
- `dna-orb-canvas` has zero service injections; receives all data via `@bindable` and communicates via DOM events
- Clear separation: data access (stateless) vs UI state (component-owned)
- `DiscoverPage` is the single coordinator between data layer and canvas

**Non-Goals:**
- Changing the backend API or RPC definitions
- Modifying bubble physics or rendering logic
- Changing the visual design

## Decisions

### 1. Data access layer

**Decision**: Consolidate RPC calls into `ArtistServiceClient` (already exists). Add `listTop()`, `listSimilar()`, `search()` methods that return plain data. Remove the duplicate `artistClient` from `ArtistDiscoveryService`.

```
ArtistServiceClient (singleton, stateless data access)
  - follow(id, name)        — existing (onboarding/auth branch)
  - unfollow(id)             — existing
  - listFollowed()           — existing
  - listTop(country, tag)    — moved from ArtistDiscoveryService
  - listSimilar(artistId)    — moved from ArtistDiscoveryService
  - search(query)            — moved from ArtistDiscoveryService
```

### 2. Bubble pool management

**Decision**: Create a plain class `BubblePool` (not DI-registered) that manages the available bubbles array, deduplication sets, and eviction logic. Owned and instantiated by `DiscoverPage`.

```ts
class BubblePool {
  availableBubbles: ArtistBubble[]
  add(bubbles: ArtistBubble[]): string[]  // returns evicted IDs
  remove(artistId: string): void
  evictOldest(count: number): ArtistBubble[]
  reset(): void
}
```

This makes pool logic testable without DI, and the pool lifetime matches the page lifetime (not app lifetime).

### 3. dna-orb-canvas bindable interface

**Decision**: Replace service injection with bindables and events.

```ts
// Inputs (parent → canvas)
@bindable artists: ArtistBubble[]        // replaces discoveryService.availableBubbles
@bindable followedCount: number           // existing
@bindable orbIntensity: number            // replaces discoveryService.orbIntensity
@bindable showFollowedIndicator: boolean  // existing

// Outputs (canvas → parent via DOM events)
'artist-selected'              — existing
'need-more-bubbles'            — new: { artistId, artistName, position }
'similar-artists-unavailable'  — existing
'similar-artists-error'        — existing
```

The `handleInteraction()` method in `dna-orb-canvas` will emit `need-more-bubbles` instead of calling `discoveryService.getSimilarArtists()` directly. The page handles fetching and passes new bubbles back via the `artists` bindable (or a dedicated `addBubbles()` method on the canvas ref).

### 4. orbIntensity

**Decision**: Computed in `DiscoverPage` as `Math.min(1, followedCount / 20)`. Passed to canvas via `@bindable`.

## Risks / Trade-offs

- **[Risk] Canvas needs to spawn bubbles at a specific position after follow** — The `need-more-bubbles` event includes the tap position. The page fetches similar artists and calls `dnaOrbCanvas.spawnBubblesAt(newBubbles, x, y)` via component ref. This preserves the existing spawn-at-position behavior.
- **[Trade-off] More code in DiscoverPage** — The page becomes the coordinator, adding ~40 lines. But this is the correct place for orchestration in Aurelia 2's component model.
- **[Trade-off] BubblePool as plain class vs DI service** — Plain class is intentional: pool lifetime should match page lifetime, not app lifetime. A singleton pool would leak state between navigations.
