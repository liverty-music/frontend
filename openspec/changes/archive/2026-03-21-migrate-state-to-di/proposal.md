## Why

The `@aurelia/state` Redux-style store adds unnecessary indirection for this application's simple state shape (onboarding step, guest follows, home area). Services act as thin facades that merely translate method calls into Action dispatches and `getState()` reads — a double-layered architecture with no benefit. Routes and components bypass the facade layer via direct `resolveStore()` calls, creating two competing access paths. Aurelia 2's native observation system (`@observable`, `@computed`, direct property binding) provides fine-grained reactivity without needing a separate store abstraction.

## What Changes

- **BREAKING**: Remove `@aurelia/state` dependency and the entire `src/state/` directory (actions, reducer, middleware, app-state, store-interface)
- **BREAKING**: Remove `StateDefaultConfiguration` registration from `main.ts`
- Replace `OnboardingService` thin facade with a self-contained `@singleton` service using `@observable` properties and `propertyChanged` callbacks for localStorage persistence
- Replace `LocalArtistClient` thin facade with a self-contained `GuestService` using direct array mutation and `@observable` properties
- Eliminate all `resolveStore()` / `store.dispatch()` / `store.getState()` calls from routes and components, replacing with `resolve(IOnboardingService)` / `resolve(IGuestService)` method calls
- **BREAKING**: Simplify `adapter/storage/guest-storage.ts` by removing all legacy format support (VO wrapped, flat `artistId`, snake_case fanart) — POJO-only serialization
- Remove `@aurelia/state` from `package.json`

## Capabilities

### New Capabilities

_None — this is a refactoring of existing capabilities._

### Modified Capabilities

- `state-management`: Replace Redux-style store (actions, reducer, middleware, `IStore`) with DI-managed `@singleton` services using Aurelia native `@observable` / `@computed` for reactivity and `propertyChanged` callbacks for persistence

## Impact

- **Frontend code**: 16 files modified or deleted across `src/state/`, `src/services/`, `src/routes/`, `src/components/`, `src/adapter/storage/`, and `src/main.ts`
- **Dependencies**: `@aurelia/state` removed from `package.json`
- **localStorage**: Existing persisted data remains compatible (same keys, same POJO format for new writes). Legacy format reads are dropped — acceptable for pre-release
- **Tests**: Existing unit tests for reducer and middleware become obsolete; replaced by service-level tests
- **No backend or specification repo changes required** — this is a frontend-internal refactoring
