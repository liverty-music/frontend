## Why

The artist discovery UI is split into two separate page components: `ArtistDiscoveryPage` (onboarding) and `DiscoverPage` (normal). They share the same core UX — a `dna-orb-canvas` with artist bubbles — but diverge in accidental ways:

1. **Onboarding lacks search bar and genre filter** — Users who cannot find their favorite artists in the random bubble pool have no way to search, increasing drop-off risk during onboarding.
2. **Two separate follow code paths** — `ArtistDiscoveryPage` calls `artistService.follow()` + `discoveryService.markFollowed()` (two steps), while `DiscoverPage` calls `discoveryService.followArtist()` (one step with optimistic UI). The onboarding/auth branching already lives in `ArtistServiceClient`, making the page-level split redundant.
3. **Duplicated CSS** — The starfield background, orb-label, and container layout are copy-pasted between the two CSS files.
4. **Unnecessary route split** — `/onboarding/discover` vs `/discover` adds routing complexity when `OnboardingService.isOnboarding` already determines the mode.

The only true onboarding-specific elements are the guidance HUD (progress dots + message) and the CTA button (needed because bottom nav is hidden during onboarding). These can be conditionally rendered with `show.bind="isOnboarding"`.

## What Changes

- Delete `routes/artist-discovery/` directory entirely (page, CSS, tests)
- Merge onboarding HUD (progress dots, guidance message, CTA) into `DiscoverPage` template and CSS
- Unify route to `/discover` with `data: { auth: false }` (accessible during onboarding without authentication)
- Update all references from `onboarding/discover` to `discover` (welcome-page, loading-sequence, onboarding-service STEP_ROUTE_MAP, auth-hook, tests)
- Unify follow flow: `discoveryService.followArtist()` delegates persistence to `ArtistServiceClient.follow()` instead of calling backend RPC directly
- Remove CTA button for normal (non-onboarding) mode — bottom nav provides navigation
- Add visibility change pause/resume (missing from old onboarding page)

## Capabilities

### Modified Capabilities

- `onboarding-guidance`: Guidance HUD rendered inside unified `DiscoverPage` via `show.bind="isOnboarding"`; route changed from `/onboarding/discover` to `/discover`

## Impact

- `src/routes/artist-discovery/` — Deleted
- `src/routes/discover/discover-page.ts` — Add onboarding HUD logic, CTA for onboarding, unified follow flow
- `src/routes/discover/discover-page.html` — Add onboarding HUD template, conditional CTA
- `src/routes/discover/discover-page.css` — Add onboarding HUD styles (from artist-discovery-page.css)
- `src/services/artist-discovery-service.ts` — `followArtist()` delegates to `ArtistServiceClient` instead of direct RPC
- `src/services/onboarding-service.ts` — Update `STEP_ROUTE_MAP[DISCOVER]` to `'discover'`
- `src/my-app.ts` — Remove `onboarding/discover` route, update `discover` route data
- `src/welcome-page.ts` — Update navigation target
- `src/routes/onboarding-loading/loading-sequence.ts` — Update fallback redirect path
- `test/` — Update affected test files
