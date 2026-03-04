## Why

`ArtistDiscoveryService` is a singleton service that mixes three distinct responsibilities:

1. **Data access** — RPC calls to `ArtistService` (listTop, listSimilar, search, follow, listFollowed)
2. **Bubble pool management** — Deduplication, eviction, pool size limits, seen-artist tracking
3. **UI state** — `availableBubbles`, `followedArtists`, `orbIntensity`, `followedIds`

This causes two problems:

- **`dna-orb-canvas` injects the service directly** to read `availableBubbles`, `orbIntensity`, call `getSimilarArtists()`, and `evictOldest()`. This creates a bidirectional data flow between component and service, violating Aurelia 2's unidirectional data flow principle (parent → child via `@bindable`, child → parent via events).
- **The service holds UI state that belongs to the page component.** `orbIntensity` and `followedArtists` are presentation concerns that should live in the component managing the view, not in a singleton service shared across the app lifecycle.

## What Changes

- Extract data access into a stateless `ArtistRepository` (or rename existing `ArtistServiceClient` to absorb this role)
- Move bubble pool management (availableBubbles, dedup, eviction, seen sets) into `DiscoverPage` or a dedicated `BubblePoolManager` class (non-DI, owned by the page)
- Remove `IArtistDiscoveryService` injection from `dna-orb-canvas`; pass data via `@bindable` properties and communicate via DOM events
- Move `orbIntensity` to `DiscoverPage` (computed from followedCount)

## Capabilities

### Modified Capabilities

- `artist-discovery-dna-orb-ui`: `dna-orb-canvas` receives artist data via `@bindable` instead of injecting a service; emits `need-more-bubbles` event instead of calling service methods directly

## Impact

- `src/services/artist-discovery-service.ts` — Split or significantly reduce; data access methods remain, state management removed
- `src/components/dna-orb/dna-orb-canvas.ts` — Remove `IArtistDiscoveryService` injection; add `@bindable artists`, emit events for bubble requests
- `src/routes/discover/discover-page.ts` — Takes ownership of bubble pool state; orchestrates data flow between service and canvas
- Tests for all affected files
