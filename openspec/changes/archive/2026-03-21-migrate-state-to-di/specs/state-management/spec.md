## ADDED Requirements

### Requirement: OnboardingService as singleton state owner

The system SHALL provide an `OnboardingService` registered as `@singleton` via `DI.createInterface<IOnboardingService>()` that owns all onboarding state. Only properties requiring persistence side-effects (`step`) SHALL use `@observable`. Spotlight properties (`spotlightTarget`, `spotlightMessage`, `spotlightRadius`, `spotlightActive`) SHALL be plain class properties — Aurelia's template binding observes them automatically without `@observable`.

#### Scenario: Step property is observable

- **WHEN** `OnboardingService.step` is changed via `setStep()`
- **THEN** Aurelia templates bound to `onboarding.step` SHALL update automatically without dispatch or getState

#### Scenario: Spotlight properties are plain

- **WHEN** `activateSpotlight()` is called
- **THEN** `spotlightTarget`, `spotlightMessage`, `spotlightRadius`, and `spotlightActive` SHALL update and be reflected in bound templates
- **AND** these properties SHALL NOT use `@observable` (no persistence side-effects needed)

#### Scenario: Callback properties preserved

- **WHEN** `OnboardingService` is instantiated
- **THEN** it SHALL expose `onSpotlightTap` and `onBringToFront` callback properties as plain instance properties (not observable)

### Requirement: GuestService as singleton state owner

The system SHALL provide a `GuestService` registered as `@singleton` via `DI.createInterface<IGuestService>()` that owns all guest state: `follows` (GuestFollow array) and `home` (string | null). It SHALL also expose `followedCount` getter and `listFollowed()` method for consumers. The legacy `getHome()` method SHALL be removed — consumers access `home` as a public property directly.

#### Scenario: Follow an artist

- **WHEN** `follow(artist)` is called with an artist not already in `follows`
- **THEN** the artist SHALL be appended to `follows` via `push()` as a `GuestFollow` with `home: null`
- **AND** templates using `repeat.for` over `follows` SHALL update

#### Scenario: Follow duplicate artist

- **WHEN** `follow(artist)` is called with an artist whose `id` already exists in `follows`
- **THEN** `follows` SHALL remain unchanged

#### Scenario: Unfollow an artist

- **WHEN** `unfollow(id)` is called
- **THEN** the matching entry SHALL be removed from `follows` via `splice()`

#### Scenario: Set user home

- **WHEN** `setHome(code)` is called
- **THEN** `home` SHALL be set to the given ISO 3166-2 code

#### Scenario: Clear all guest data

- **WHEN** `clearAll()` is called
- **THEN** `follows` SHALL be cleared via `splice(0)` (same array reference) and `home` set to null

#### Scenario: followedCount getter

- **WHEN** `followedCount` is accessed
- **THEN** it SHALL return `follows.length`

#### Scenario: listFollowed projection

- **WHEN** `listFollowed()` is called
- **THEN** it SHALL return an array of `{ id, name }` objects projected from the current `follows` array

#### Scenario: Home accessed as property

- **WHEN** a consumer needs the guest home value
- **THEN** it SHALL access `guestService.home` directly as a public property
- **AND** no `getHome()` method SHALL exist

### Requirement: GuestFollow type in entities

The system SHALL define `GuestFollow` as an interface in `src/entities/` containing `artist: Artist` and `home: string | null`.

#### Scenario: GuestFollow structure

- **WHEN** `GuestFollow` is imported
- **THEN** it SHALL have an `artist` field of type `Artist` and a `home` field of type `string | null`

### Requirement: Service-level persistence via propertyChanged

Each service SHALL persist its own state to localStorage using `@observable` `propertyChanged` callbacks (for scalar properties) or explicit persistence calls after array mutation. Persistence correctness SHALL be verified via `guest-storage.ts` and `onboarding-storage.ts` unit tests. Service-level tests SHALL focus on business logic (duplicate guard, clearAll, step transitions), not localStorage side-effects.

#### Scenario: Onboarding step persisted on change

- **WHEN** `OnboardingService.step` changes (after initial hydration)
- **THEN** `stepChanged()` SHALL write the new step value to localStorage key `onboardingStep`

#### Scenario: Guest follows persisted after mutation

- **WHEN** `follows` array is mutated via `follow()`, `unfollow()`, or `clearAll()`
- **THEN** the service SHALL call `saveFollows()` from `adapter/storage/guest-storage.ts` to persist the current array

#### Scenario: Guest home persisted on change

- **WHEN** `GuestService.home` changes (after initial hydration)
- **THEN** `homeChanged()` SHALL write to localStorage key `guest.home`, or remove the key if null

### Requirement: Service hydration from localStorage

Each service SHALL hydrate its initial state from localStorage at field initialization time. Hydrated values SHALL be assigned directly in field initializers (e.g., `@observable step = loadStep()`) so that `propertyChanged` callbacks do NOT fire during hydration.

#### Scenario: OnboardingService hydrates step

- **WHEN** `OnboardingService` is instantiated
- **THEN** the `step` field initializer SHALL call `loadStep()` which reads `onboardingStep` from localStorage and returns the stored value if valid, or `'lp'` if missing/invalid

#### Scenario: GuestService hydrates follows and home

- **WHEN** `GuestService` is instantiated
- **THEN** the `follows` field initializer SHALL call `loadFollows()` and the `home` field initializer SHALL call `loadHome()` from `adapter/storage/guest-storage.ts`

#### Scenario: No spurious persistence on hydration

- **WHEN** services are instantiated with persisted state
- **THEN** `stepChanged()` and `homeChanged()` SHALL NOT fire during field initialization
- **AND** no redundant localStorage writes SHALL occur

### Requirement: Simplified guest-storage POJO-only serialization

The `adapter/storage/guest-storage.ts` module SHALL serialize and deserialize `GuestFollow[]` as plain JSON without legacy format support.

#### Scenario: Save follows

- **WHEN** `saveFollows(follows)` is called
- **THEN** it SHALL write `JSON.stringify(follows)` to localStorage key `guest.followedArtists`

#### Scenario: Load follows with valid data

- **WHEN** `loadFollows()` is called and localStorage contains a valid JSON array of `GuestFollow` objects
- **THEN** it SHALL return the parsed array

#### Scenario: Load follows with invalid data

- **WHEN** `loadFollows()` is called and localStorage contains invalid JSON or a non-array value
- **THEN** it SHALL return an empty array

#### Scenario: No legacy format support

- **WHEN** localStorage contains data in VO-wrapped format (`{ id: { value: "..." } }`), flat `artistId` format, or snake_case fanart fields
- **THEN** `loadFollows()` SHALL NOT attempt to parse these formats and SHALL return entries only if they match the current POJO structure

### Requirement: Single DI access path

All routes and components SHALL access onboarding and guest state exclusively through `resolve(IOnboardingService)` and `resolve(IGuestService)`. Direct store resolution (`resolveStore()`, `resolve(IStore)`) SHALL NOT exist in the codebase.

#### Scenario: No direct store access

- **WHEN** the codebase is searched for `resolveStore`, `IStore`, or `@aurelia/state` imports
- **THEN** zero results SHALL be found outside of test files

## MODIFIED Requirements

### Requirement: OnboardingStep string values

The system SHALL define `OnboardingStep` as a const object with string literal values representing each step by name.

#### Scenario: Step values

- **WHEN** `OnboardingStep` is defined
- **THEN** it SHALL contain exactly these entries: `LP: 'lp'`, `DISCOVERY: 'discovery'`, `DASHBOARD: 'dashboard'`, `DETAIL: 'detail'`, `MY_ARTISTS: 'my-artists'`, `COMPLETED: 'completed'`
- **AND** it SHALL NOT contain `LOADING` or `SIGNUP`

#### Scenario: Step ordering

- **WHEN** step ordering is needed (e.g., auth-hook route guard)
- **THEN** the system SHALL use an explicit `STEP_ORDER` array to determine step precedence
- **AND** the system SHALL provide a `stepIndex(step)` function that returns the ordinal position

#### Scenario: Onboarding detection

- **WHEN** determining if the user is in the onboarding flow
- **THEN** the system SHALL check membership in an `ONBOARDING_STEPS` Set containing `'discovery'`, `'dashboard'`, `'detail'`, `'my-artists'`
- **AND** the system SHALL NOT use numeric range comparison

### Requirement: Persistence middleware

The system SHALL persist onboarding step, guest follows, and guest home to localStorage. The previous `After` middleware pattern is replaced by the "Service-level persistence via propertyChanged" requirement (see ADDED). This requirement retains only the contract of WHAT is persisted and under which localStorage keys.

#### Scenario: Persisted keys unchanged

- **WHEN** state is persisted
- **THEN** the system SHALL use the same localStorage keys as before: `onboardingStep`, `guest.followedArtists`, `guest.home`

### Requirement: State hydration from localStorage

The system SHALL hydrate initial state from localStorage, validating string step values. Hydration SHALL occur at field initialization time in each service, replacing the previous `loadPersistedState()` function.

#### Scenario: Valid string step in localStorage

- **WHEN** `OnboardingService` is instantiated and localStorage contains a recognized string step value
- **THEN** the field initializer SHALL set `step` to that value

#### Scenario: Invalid or unrecognized step in localStorage

- **WHEN** `OnboardingService` is instantiated and localStorage contains an unrecognized step value
- **THEN** it SHALL fall back to `'lp'` and overwrite localStorage

## REMOVED Requirements

### Requirement: AppState type definition

**Reason**: Replaced by per-service state ownership. Onboarding state lives in `OnboardingService`, guest state in `GuestService`. No unified `AppState` interface is needed.

**Migration**: Delete `src/state/app-state.ts`. Move `GuestFollow` type to `src/entities/`.

### Requirement: Action type definition

**Reason**: Actions are a Redux concept. State mutations are now direct method calls on services.

**Migration**: Delete `src/state/actions.ts`.

### Requirement: Reducer as pure function

**Reason**: The reducer is replaced by service methods that directly mutate `@observable` properties. Business logic (e.g., duplicate follow guard) moves into service methods.

**Migration**: Delete `src/state/reducer.ts`. Port business logic to service methods.

### Requirement: Logging middleware via factory

**Reason**: Logging is handled by each service using `ILogger.scopeTo()` in its methods, as services already do today.

**Migration**: Delete logging middleware from `src/state/middleware.ts`.

### Requirement: Store resolution requires active DI context

**Reason**: `IStore` and `resolveStore()` are removed. Services are resolved via standard `resolve()` which already requires DI context.

**Migration**: Delete `src/state/store-interface.ts`. Replace all `resolveStore()` calls with `resolve(IOnboardingService)` or `resolve(IGuestService)`.
