## Context

The frontend currently uses `@aurelia/state` (Redux-style) for onboarding and guest data. The state shape is simple — an onboarding step string, a spotlight config, an array of guest follows, and a nullable home string. Despite this simplicity, the architecture requires actions, a reducer, middleware, a store interface, and facade services. Routes and components inconsistently access state through both facades and direct `resolveStore()` calls.

Aurelia 2 provides native fine-grained reactivity via `@observable`, `@computed`, and automatic property observation in templates. These primitives make the Redux layer redundant for this use case.

## Goals / Non-Goals

**Goals:**
- Eliminate `@aurelia/state` and the `src/state/` directory entirely
- Consolidate state into two `@singleton` services: `OnboardingService` and `GuestService`
- Use Aurelia native `@observable` for persistence side-effects via `propertyChanged` callbacks
- Enforce a single access path: DI interfaces (`IOnboardingService`, `IGuestService`)
- Simplify `guest-storage.ts` to POJO-only serialization (drop legacy format support)

**Non-Goals:**
- Introducing `signal-polyfill` or TC39 Signals — Aurelia native observation is sufficient
- Changing the localStorage key names or breaking the current POJO format
- Refactoring services beyond state management (e.g., `AuthService`, `LastfmService`)
- Adding new features or capabilities

## Decisions

### 1. Two domain services instead of one monolithic store

Split the single `AppState` into `OnboardingService` (onboarding step + spotlight) and `GuestService` (follows + home). Each service owns its state and persistence.

**Why**: These two domains have no cross-cutting logic. The only interaction is `GuestDataMergeService` which reads guest data and then completes onboarding — this is orchestration, not shared state. Separate services enable independent testing and clearer ownership.

**Alternative considered**: Single `AppStateService` mirroring the current `AppState` shape. Rejected because it would recreate the monolith without the Redux ceremony.

### 2. Direct property mutation, not immutable updates

Services mutate `@observable` properties directly (e.g., `this.step = newStep`). For arrays, use `push()` / `splice()` which Aurelia intercepts natively.

**Why**: Aurelia's observation system is designed for mutation. Immutable replacement (spread patterns) is a React/Redux idiom that adds allocation overhead without benefit here. Aurelia's array observation intercepts mutation methods and triggers binding updates automatically.

### 3. `propertyChanged` callbacks for persistence

Each service persists its own state via `@observable` + `propertyChanged` convention:

```
OnboardingService:
  @observable step = loadStep()  → stepChanged() → localStorage.setItem('onboardingStep', step)

GuestService:
  follows = loadFollows()        → explicit save after mutation
  @observable home = loadHome()  → homeChanged() → localStorage set/remove
```

**Hydration via field initializers**: State is hydrated at field initialization time (e.g., `@observable step = loadStep()`), NOT in the constructor. This prevents `propertyChanged` from firing during hydration — the callback only fires when the value changes from the initial value.

**Why over a central PersistenceService**: Only 3 fields are persisted. Distributing persistence into each service keeps the logic co-located with the state it persists. A central service would add indirection for no gain.

**Array persistence caveat**: `@observable` on an array fires `propertyChanged` only on reference change (reassignment), not on `push()`/`splice()`. The service methods that mutate `follows` will call a private `persistFollows()` method explicitly after mutation. `clearAll()` uses `splice(0)` to preserve the array reference rather than reassignment.

**`@observable` only for persisted properties**: Spotlight properties (`spotlightTarget`, `spotlightMessage`, `spotlightRadius`, `spotlightActive`) do NOT need `@observable` — they have no persistence side-effects. Aurelia's template binding auto-observes plain properties.

### 4. Existing DI interface pattern preserved

`OnboardingService` already uses `DI.createInterface<IOnboardingService>()`. This pattern is preserved. `LocalArtistClient` is renamed to `GuestService` with a new `IGuestService` interface, following the same pattern. `GuestService` exposes `followedCount` getter and `listFollowed()` projection for existing consumers. The legacy `getHome()` method is removed — `home` is a public `@observable` property accessed directly.

### 5. guest-storage.ts simplified to save/load functions

The current 160-line file with 3 legacy format parsers becomes ~30 lines:
- `saveFollows(follows: GuestFollow[]): void` — `JSON.stringify` + `localStorage.setItem`
- `loadFollows(): GuestFollow[]` — `localStorage.getItem` + `JSON.parse` + type guard
- `saveHome(code: string | null): void`
- `loadHome(): string | null`

Legacy formats (VO-wrapped, `artistId` key, snake_case fanart) are removed. This is safe because the app is pre-release.

### 6. GuestFollow type moves from state/app-state.ts to entities

`GuestFollow` is a domain type (an artist paired with a nullable home). It belongs in `src/entities/`, not in the now-deleted `src/state/app-state.ts`.

## Risks / Trade-offs

**[Array observation gap]** → Aurelia auto-observes array mutation methods in templates (`repeat.for`), but `@observable` `Changed` callback does not fire on `push()`/`splice()`. Persistence after array mutation must be called explicitly in each service method. Mitigation: each method that mutates `follows` ends with `this.persistFollows()`.

**[Getter reactivity in templates]** → Current services expose getters like `get followedCount()`. In Aurelia, plain getters are observed by default in templates but have no caching. For cheap computations (`.length`) this is fine. If expensive getters are needed in the future, add `@computed`. Mitigation: none needed now — current getters are trivial.

**[Test migration]** → Existing reducer and middleware tests become obsolete. New tests will exercise service methods directly, which is simpler. Mitigation: delete old tests, write new service-level tests as part of the task list. Service tests focus on business logic; persistence correctness is covered by storage module unit tests.

**[Spotlight complexity]** → `OnboardingService` owns both step management and spotlight (coach mark) state (5 properties + 2 callbacks). These are separate concerns but currently coupled. If spotlight grows in complexity, extract to a dedicated `SpotlightService`. This is explicitly out of scope for this change.
