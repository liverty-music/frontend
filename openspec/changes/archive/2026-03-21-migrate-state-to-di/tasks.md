## 1. Entity and Storage Foundation

- [x] 1.1 Move `GuestFollow` interface from `src/state/app-state.ts` to `src/entities/follow.ts`
- [x] 1.2 Simplify `src/adapter/storage/guest-storage.ts` — remove all legacy format support (VO-wrapped, `artistId` key, snake_case fanart), implement `saveFollows()`, `loadFollows()`, `saveHome()`, `loadHome()` as POJO-only functions that encapsulate localStorage access
- [x] 1.3 Add `src/adapter/storage/onboarding-storage.ts` with `saveStep()` and `loadStep()` functions (encapsulate localStorage key and `normalizeStep` validation)

## 2. Service Refactoring

- [x] 2.1 Rewrite `OnboardingService` — remove `resolveStore()` dependency, add `@observable step` with `stepChanged()` callback for persistence, hydrate from `loadStep()` in constructor, keep existing DI interface and public API
- [x] 2.2 Create `GuestService` (replacing `LocalArtistClient`) — own `follows` array and `@observable home`, hydrate from `loadFollows()`/`loadHome()` in constructor, call `saveFollows()`/`saveHome()` explicitly after mutations, register via `DI.createInterface<IGuestService>()`
- [x] 2.3 Update `src/services/follow-service-client.ts` to use `IGuestService` instead of `ILocalArtistClient` / `resolveStore()`
- [x] 2.4 Update `src/services/guest-data-merge-service.ts` to use `IGuestService` and `IOnboardingService` instead of store
- [x] 2.5 Update `src/services/concert-service.ts` to use `IGuestService` instead of `resolveStore()`

## 3. Route and Component Migration

- [x] 3.1 Update `welcome-route.ts` — replace `resolveStore()` + dispatch with `resolve(IOnboardingService)` and `resolve(IGuestService)` method calls
- [x] 3.2 Update `dashboard-route.ts` — replace `resolveStore()` + dispatch with service method calls
- [x] 3.3 Update `discovery-route.ts` — replace `store.getState()` reads with `resolve(IGuestService)` property access
- [x] 3.4 Update `auth-callback-route.ts` — replace `store.getState().guest.home` with `resolve(IGuestService).home`
- [x] 3.5 Update `user-home-selector.ts` — replace `resolveStore()` + dispatch with `resolve(IGuestService).setHome()`

## 4. Cleanup

- [x] 4.1 Delete `src/state/` directory (actions.ts, reducer.ts, middleware.ts, app-state.ts, store-interface.ts)
- [x] 4.2 Remove `StateDefaultConfiguration` registration and middleware setup from `src/main.ts`
- [x] 4.3 Remove `@aurelia/state` from `package.json` and run `npm install`

## 5. Tests

- [x] 5.1 Delete obsolete reducer and middleware tests
- [x] 5.2 Write unit tests for `OnboardingService` (hydration, step transitions, persistence, spotlight)
- [x] 5.3 Write unit tests for `GuestService` (hydration, follow/unfollow, duplicate guard, home, clearAll, persistence)
- [x] 5.4 Update `guest-storage.ts` tests to remove legacy format test cases and verify POJO-only behavior
- [x] 5.5 Run `make check` (lint + test) to verify all changes pass
