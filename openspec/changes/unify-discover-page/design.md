## Context

Two page components serve the artist discovery experience: `ArtistDiscoveryPage` at `/onboarding/discover` and `DiscoverPage` at `/discover`. Both render the same `dna-orb-canvas` component and use `IArtistDiscoveryService`, but differ in:

- Onboarding HUD (progress dots, guidance message) — onboarding only
- Search bar and genre filter — normal only
- CTA button behavior — different navigation targets
- Follow code path — different service method calls
- CSS — 95% duplicated starfield/container styles

The onboarding/auth branching for follow persistence already lives in `ArtistServiceClient` (localStorage vs backend RPC), so the page-level split is redundant.

## Goals / Non-Goals

**Goals:**
- Single `DiscoverPage` component at `/discover` for both onboarding and normal use
- Search bar and genre filter available during onboarding (reduces drop-off)
- CTA button shown only during onboarding (bottom nav covers normal navigation)
- Single follow code path through `discoveryService.followArtist()` → `ArtistServiceClient`
- Delete `routes/artist-discovery/` entirely

**Non-Goals:**
- Refactoring `ArtistDiscoveryService` responsibilities (Phase 2: `decouple-discovery-service`)
- Changing `dna-orb-canvas` to use bindables instead of service injection (Phase 2)
- Modifying bubble physics or rendering

## Decisions

### 1. Route unification

**Decision**: Single route `/discover` with `data: { auth: false }`.

Onboarding users are unauthenticated and need access. The page itself is harmless for unauthenticated users — discovering artists without signing in is fine. `OnboardingService.isOnboarding` determines whether to show guidance HUD and CTA.

```ts
// my-app.ts — single route replaces two
{
  path: 'discover',
  component: import('./routes/discover/discover-page'),
  title: 'Discover',
  data: { auth: false },
}
```

`fullscreenRoutes` in `my-app.ts`: `/discover` should NOT be fullscreen in normal mode (bottom nav visible), but SHOULD be fullscreen during onboarding. This requires checking `isOnboarding` in the `showNav` getter rather than hardcoding path names.

### 2. Onboarding HUD as conditional section

**Decision**: Add the HUD (progress dots + guidance message) and CTA button to `discover-page.html` with `show.bind="isOnboarding"`.

```html
<!-- Onboarding guidance overlay -->
<div show.bind="isOnboarding" class="onboarding-hud">
  <div class="progress-dots">
    <span class="dot ${followedCount >= 1 ? 'filled' : ''}"></span>
    <span class="dot ${followedCount >= 2 ? 'filled' : ''}"></span>
    <span class="dot ${followedCount >= 3 ? 'filled' : ''}"></span>
  </div>
  <p class="hud-message ${guidanceHiding ? 'hiding' : ''}">
    ${guidanceMessage}
  </p>
</div>

<!-- CTA — onboarding only (normal mode uses bottom nav) -->
<div show.bind="showCompleteButton" class="complete-button-wrapper">
  <button click.trigger="onViewSchedule()" class="complete-button tutorial-cta">
    ${$this.i18n?.tr('discovery.generateDashboard') ?? ''}
  </button>
</div>
```

### 3. Unified follow flow

**Decision**: `ArtistDiscoveryService.followArtist()` delegates persistence to `ArtistServiceClient.follow()` instead of calling `this.artistClient.follow()` directly.

Current (broken separation):
```
DiscoverPage → discoveryService.followArtist() → artistClient.follow() (direct RPC)
ArtistDiscoveryPage → artistService.follow() → localClient or RPC (branched)
                    → discoveryService.markFollowed() (UI only)
```

Unified:
```
DiscoverPage → discoveryService.followArtist()
                → optimistic UI update (existing)
                → artistServiceClient.follow(id, name) (onboarding/auth branch inside)
                → on failure: rollback (existing)
```

This removes the need for `markFollowed()` as a separate method and eliminates the `ArtistServiceClient` + `ILocalArtistClient` imports from the page.

### 4. followedCount source

**Decision**: Always use `discoveryService.followedArtists.length`. During onboarding, `followArtist()` still updates this array via optimistic UI, and `ArtistServiceClient.follow()` handles localStorage persistence internally.

### 5. CTA button — onboarding only

**Decision**: The CTA button (and `onViewSchedule()`) only renders during onboarding. In normal mode, the bottom navigation provides all needed transitions. The `showCompleteButton` getter becomes:

```ts
public get showCompleteButton(): boolean {
  return this.isOnboarding && this.followedCount >= TUTORIAL_FOLLOW_TARGET
}
```

### 6. Bottom nav visibility during onboarding

**Decision**: Update `my-app.ts` `showNav` to check onboarding state rather than hardcoding `/discover` in `fullscreenRoutes`. When `isOnboarding` is true and on `/discover`, hide nav.

## Risks / Trade-offs

- **[Risk] `auth: false` on `/discover` exposes the page to unauthenticated non-onboarding users** — Acceptable; the page fetches from `ListTop` (public data) and follow attempts by unauthenticated users will fail at the RPC layer with an auth error, which is already handled by toast notification.
- **[Risk] `followArtist()` rollback on error during onboarding** — `ArtistServiceClient.follow()` writes to localStorage synchronously and never throws during onboarding, so rollback will not trigger. Safe.
- **[Trade-off] Slightly larger single component vs two focused ones** — The added onboarding logic is ~30 lines of template + ~20 lines of TS. Acceptable given the elimination of an entire duplicated page.
