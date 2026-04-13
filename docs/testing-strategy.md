# Frontend Testing Strategy

**Repository**: `liverty-music/frontend`
**Framework**: Aurelia 2 + Vitest + Playwright

---

## 1. Testing Architecture

### Testing Trophy for This Project

```
         ▲
        / \
       /E2E \        ← Playwright: 4-6 critical user journeys
      /───────\
     /Component\     ← createFixture: template bindings, DOM interactions
    /───────────\
   /  DI Unit    \   ← DI container: services, route guards, component logic
  /───────────────\
 /   Pure Unit     \  ← No DI: utilities, value converters, pure functions
/───────────────────\
│  Static Analysis  │  ← TypeScript strict + Biome lint
└───────────────────┘
```

Two co-primary test layers work together:

- **Component Integration tests** via `createFixture()` — the default for components with templates. Verifies view + view-model together, per [Aurelia 2 official testing documentation](https://docs.aurelia.io/developer-guides/overview/testing-components).
- **DI Unit tests** via `createTestContainer()` — the default for services, interceptors, and guards with no template.

Both use `Registration.instance()` for DI mocking. Component tests additionally use `@aurelia/testing` assertion helpers (`assertText`, `assertAttr`, `trigger.click`, etc.) and `tasksSettled()` for reactive updates.

### Test Type Decision Flow

```
  Is it a pure function with no dependencies?
  ├── YES → Pure Unit Test (no DI, no DOM)
  │         Examples: artistColor(), bytesToDecimal(), DateValueConverter
  │
  └── NO → Is it a component with a template?
           ├── YES → Component Integration Test (createFixture)
           │         Use: assertText, trigger.click, getBy, type()
           │         DI mocking via Registration.instance() in deps
           │
           └── NO → Is it a service, interceptor, or guard?
                    ├── YES → DI Unit Test (createTestContainer)
                    │         Examples: service methods, canLoad guards,
                    │                  computed properties, event dispatch
                    │
                    └── NO → E2E Test (Playwright)
                              Examples: onboarding flow, auth redirect
```

### Module Type → Test Approach

| Module Type | Test Approach | DI? | DOM? | Key Technique |
|---|---|---|---|---|
| Pure utility functions | Pure Unit | No | No | Direct function call |
| Value converters | Pure Unit | No | No | `new Converter().toView(...)` |
| Services (gRPC wrappers) | DI Unit | Yes | No | Mock RPC client via `Registration.instance` |
| Services (complex logic) | DI Unit | Yes | No | Mock deps + `vi.useFakeTimers()` + AbortController |
| Route guards (`canLoad`) | DI Unit | Yes | No | Direct method invocation, assert return value |
| Route data loading (`loading`) | DI Unit | Yes | No | Mock services, assert state mutations |
| Component computed properties | DI Unit | Yes | No | `container.get(Component)` → read property |
| Component CustomEvent dispatch | DI Unit | Yes | Minimal | `INode` mock + `addEventListener` |
| Component template bindings | Component Integration | Yes | Yes | `createFixture` + `assertText` / `getBy` |
| ConnectRPC interceptors | DI Unit | Partial | No | Mock `next` function, fake timers |
| Full user journeys | E2E | N/A | N/A | Playwright POM |

---

## 2. Test Patterns Reference

### Pattern A: DI-Registered Service (Standard)

**When to use**: Service with injected dependencies, no import-time side effects.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Registration } from 'aurelia'
import { createTestContainer } from '../helpers/create-container'

describe('MyService', () => {
  let sut: MyService
  let mockDep: Partial<IDependency>

  beforeEach(() => {
    mockDep = {
      doSomething: vi.fn().mockResolvedValue('result'),
    }
    const container = createTestContainer(
      Registration.instance(IDependency, mockDep),
    )
    container.register(MyService)
    sut = container.get(IMyService)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should delegate to dependency', async () => {
    mockDep.doSomething!.mockResolvedValue('custom')

    const result = await sut.process()

    expect(result).toBe('custom')
    expect(mockDep.doSomething).toHaveBeenCalledOnce()
  })
})
```

### Pattern B: Service with Import-Time Side Effects

**When to use**: Module imports proto-generated clients, reads `window.location`, or has other parse-time effects.

```typescript
import { DI, Registration } from 'aurelia'
import { createTestContainer } from '../helpers/create-container'

// Step 1: Mock modules BEFORE any import
const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../src/services/auth-service', () => ({
  IAuthService: mockIAuthService,
}))

// Step 2: Dynamic import AFTER mocks are in place
const { MyServiceClass } = await import('../../src/services/my-service')

describe('MyService', () => {
  // ... standard DI-Unit test
})
```

**When `vi.mock()` is justified**:
- Proto-generated imports (`@buf/liverty-music_schema.*`)
- `auth-service.ts` (reads `window.location.origin` at parse time)
- `grpc-transport.ts` (factory with complex dependencies)

**When `vi.mock()` is NOT justified**:
- Pure utility functions
- Services with no import side effects
- Components that only use DI-injected dependencies

### Pattern C: Interceptor / Higher-Order Function

**When to use**: gRPC interceptors, middleware, decorators.

```typescript
describe('createMyInterceptor', () => {
  it('should transform the request', async () => {
    const response = { data: 'ok' }
    const next = vi.fn().mockResolvedValue(response)
    const interceptor = createMyInterceptor(config)
    const handler = interceptor(next)

    const result = await handler(makeRequest())

    expect(result).toBe(response)
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ header: expect.any(Headers) }),
    )
  })
})
```

### Pattern D: Timer-Based Orchestration

**When to use**: Services with timeouts, debounce, animation timing.

```typescript
describe('TimerService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should timeout after 10 seconds', async () => {
    mockDep.slowOperation = vi.fn().mockImplementation(
      (_arg: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )

    const promise = sut.aggregateData()
    await vi.advanceTimersByTimeAsync(10000)

    const result = await promise
    expect(result.status).toBe('failed')
  })
})
```

**Critical rules**:
- ALWAYS use `vi.advanceTimersByTimeAsync()` (not sync version) to avoid promise/timer deadlock
- ALWAYS restore real timers in `afterEach()`
- ALWAYS make mocks signal-aware when testing abort scenarios

### Pattern E: AbortController / AbortSignal

**When to use**: Services that accept or create AbortSignals.

```typescript
it('should forward abort signal to backend', async () => {
  const controller = new AbortController()
  const promise = sut.listConcerts('artist-1', controller.signal)
  controller.abort()

  await expect(promise).rejects.toThrow()
  expect(mockClient.list).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ signal: controller.signal }),
  )
})
```

### Pattern F: Pure Utility Functions

**When to use**: Math functions, formatters, converters with no side effects.

```typescript
describe('bytesToHex', () => {
  it.each([
    [new Uint8Array([255, 0, 171]), 'ff00ab'],
    [new Uint8Array([0]), '00'],
    [new Uint8Array([]), ''],
  ])('converts %o to "%s"', (input, expected) => {
    expect(bytesToHex(input)).toBe(expected)
  })
})
```

### Pattern G: Component with INode (DOM Access)

**When to use**: Custom elements that query the DOM via `INode`.

```typescript
describe('EventDetailSheet', () => {
  let sut: EventDetailSheet
  let mockElement: HTMLElement

  beforeEach(async () => {
    mockElement = document.createElement('div')
    const scrollChild = document.createElement('div')
    scrollChild.classList.add('overflow-y-auto')
    mockElement.appendChild(scrollChild)

    const container = createTestContainer(
      Registration.instance(INode, mockElement),
    )
    container.register(EventDetailSheet)
    sut = container.get(EventDetailSheet)
  })
})
```

### Pattern H: Component Integration Test (createFixture fluent API)

**When to use**: Components with templates — verifies view + view-model together per [Aurelia 2 official docs](https://docs.aurelia.io/developer-guides/overview/testing-components).

```typescript
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { tasksSettled } from '@aurelia/kernel'

describe('BottomNavBar', () => {
  it('should render nav items and highlight active route', async () => {
    const mockRouter = { load: vi.fn() }

    const fixture = await createFixture
      .component(BottomNavBar)
      .html`<bottom-nav-bar></bottom-nav-bar>`
      .deps(
        Registration.instance(IRouter, mockRouter),
        Registration.instance(I18N, createMockI18n()),
      )
      .build()
      .started

    // DOM assertions via official fixture helpers
    fixture.assertText('nav-item:first-child', 'Dashboard')
    fixture.assertClass('nav-item:first-child', 'active')

    // User interaction
    fixture.trigger.click('nav-item:nth-child(2)')
    await tasksSettled()

    expect(mockRouter.load).toHaveBeenCalled()
    await fixture.stop(true)
  })
})
```

**Key helpers from `@aurelia/testing`**:
- `fixture.assertText(selector, text)` — verify text content
- `fixture.assertAttr(selector, name, value)` — verify attributes
- `fixture.assertClass(selector, ...classes)` — verify CSS classes
- `fixture.getBy(selector)` / `queryBy(selector)` — DOM query
- `fixture.trigger.click(selector)` — click simulation
- `fixture.type(selector, text)` — input simulation (triggers 2-way binding)
- `await tasksSettled()` — wait for reactive DOM updates after state mutation
- `await fixture.stop(true)` — cleanup (replaces deprecated `tearDown()`)

---

## 3. Service Complexity Tiers

```
┌──────────────────────────────────────────────────────────────────┐
│ Tier 1: Thin gRPC wrappers (ConcertService, EntryService)       │
│ Pattern: Mock the ConnectRPC client, verify call forwarding      │
│ Focus:   AbortSignal propagation, error forwarding               │
│ Mocks:   1 (the RPC client)                                     │
│ Effort:  Low                                                     │
├──────────────────────────────────────────────────────────────────┤
│ Tier 2: Stateful services (ErrorBoundaryService, NotifManager)   │
│ Pattern: Verify state mutations through public API               │
│ Focus:   Observable state changes, ring buffer limits, sanitize  │
│ Mocks:   0-1 (mostly self-contained)                             │
│ Effort:  Medium                                                  │
├──────────────────────────────────────────────────────────────────┤
│ Tier 3: Orchestrators (LoadingSequenceService, ArtistDiscovery)  │
│ Pattern: Mock all deps + fake timers + AbortController           │
│ Focus:   Batch parallelism, retry/rollback, timeout, min delay   │
│ Mocks:   2-4 services                                           │
│ Effort:  High                                                    │
├──────────────────────────────────────────────────────────────────┤
│ Tier 4: Interceptors (ConnectErrorRouter, grpc-transport)        │
│ Pattern: Mock `next` function, inject error codes                │
│ Focus:   Error classification, retry backoff, auth refresh       │
│ Mocks:   next function + auth service                            │
│ Effort:  Medium-High                                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Mock Helper Conventions

### Rules for mock factories

1. Return `Partial<IInterface>` for type safety
2. All methods default to `vi.fn()` with sensible defaults (resolve empty, return null)
3. Keep in `test/helpers/mock-*.ts` (one file per service or grouped by domain)

### Example

```typescript
// test/helpers/mock-router.ts
export function createMockRouter(): Partial<IRouter> {
  return {
    load: vi.fn().mockResolvedValue(undefined),
  }
}
```

---

## 5. Browser API Mocking Reference

| API | Mock Strategy |
|-----|--------------|
| `localStorage` | Already available via JSDOM — use `localStorage.clear()` in `afterEach` |
| `window.location.href` | `Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })` |
| `window.open` | `vi.spyOn(window, 'open').mockImplementation(() => null)` |
| `navigator.clipboard.writeText` | `Object.assign(navigator, { clipboard: { writeText: vi.fn() } })` |
| `Notification.permission` | `Object.defineProperty(Notification, 'permission', { value: 'default', configurable: true })` |
| `navigator.serviceWorker` | `Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(mockReg) } })` |
| `crypto.subtle.digest` | `vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(...)` |
| `Worker` constructor | `vi.stubGlobal('Worker', MockWorkerClass)` |
| `requestAnimationFrame` | `vi.spyOn(global, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0 })` |
| `HTMLDialogElement.showModal/close` | Attach mock methods: `el.showModal = vi.fn()` |
| `history.pushState/replaceState` | `vi.spyOn(history, 'pushState')` |
| `fetch` | `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(...))` or MSW |
| `TouchEvent` | `new TouchEvent('touchstart', { touches: [{ clientY: 100 }] })` |

---

## 6. CE Import Isolation Convention

### Rule: Import CE classes directly — never via parent route modules

Tests MUST import the target Custom Element class directly from its source file. Importing via a parent route module triggers Aurelia's template convention resolution, which loads child CE templates transitively and can cause `document is not defined` errors in node-environment tests.

```typescript
// CORRECT: Direct import — no module graph expansion
import { ConcertHighway } from '../../src/components/live-highway/concert-highway'
import { EventCard } from '../../src/components/event-card/event-card'

// WRONG: Import via route — triggers ConcertHighway → EventCard → INode chain
import { DashboardRoute } from '../../src/routes/dashboard/dashboard-route'
```

### Why this matters

Vitest evaluates `import` statements eagerly. Aurelia's convention maps `foo-route.ts` → `foo-route.html`. An `.html` template with `<import from="...">` directives causes Vitest to resolve and execute those child modules — including CEs that call `resolve(INode)` at parse time, which requires `document` to exist.

The module chain looks like:

```
dashboard-route.ts
  └─ dashboard-route.html (convention)
       └─ <import from="concert-highway">
            └─ concert-highway.ts → concert-highway.html
                 └─ <import from="event-card">
                      └─ event-card.ts → resolve(INode) → document 💥
```

### How templates avoid <import> chains

All shared CEs are globally registered in `main.ts`. Templates use CE tag names directly without `<import from="...">`:

```html
<!-- CORRECT: no <import> needed — CE is globally registered -->
<concert-highway date-groups.bind="dateGroups"></concert-highway>

<!-- WRONG: adds module graph edge that vitest must resolve -->
<import from="./concert-highway">
<concert-highway date-groups.bind="dateGroups"></concert-highway>
```

### When route-level testing is required

If a test must import a route module (e.g., dashboard-route.ts), mock its HTML template to prevent child CE chain loading:

```typescript
// vi.mock() is hoisted before imports — prevents template resolution
vi.mock('../../src/routes/dashboard/dashboard-route.html', () => ({
  default: '<div data-testid="dashboard-loading" if.bind="isLoading">Loading</div>',
}))

import { DashboardRoute } from '../../src/routes/dashboard/dashboard-route'
```

---

## 7. Anti-Pattern Checklist

| Anti-Pattern | Fix |
|---|---|
| `any` type for mocks | Use `Partial<IInterface>` or typed factory |
| `vi.useRealTimers()` inside `it()` | Move to `afterEach()` |
| `@ts-expect-error` for private access | Test through public API or use `vi.spyOn` |
| Inline mock objects duplicating helpers | Use shared factory from `test/helpers/` |
| `it.skip` with stale test body | Implement or remove (track in issue) |
| Testing implementation details | Test observable outputs (return values, state changes, mock calls) |
| Missing `vi.restoreAllMocks()` in afterEach | Always include in afterEach |
| Missing `localStorage.clear()` for tests using localStorage | Include in afterEach |
| Shared mutable state between tests | Rebuild everything in `beforeEach` |
| `expect(true).toBe(true)` tautological assertion | Use `fixture.getBy()` / `assertAttr()` for meaningful verification |
| `forEach(async)` in cleanup | Use `Promise.all(arr.map(async f => ...))` — forEach drops Promises |
| Missing `tasksSettled()` after state mutation | Always `await tasksSettled()` before DOM assertions on reactive data |
| Using deprecated `tearDown()` | Replace with `await fixture.stop(true)` |
| `appHost.querySelector` in fixture tests | Use `fixture.getBy()` / `fixture.queryBy()` instead |

---

## 8. E2E Testing (Playwright)

### Recommended Scenarios (4-6 tests)

| Scenario | Flow |
|----------|------|
| Onboarding flow | /welcome → auth → /artist-discovery → /loading → /dashboard |
| Auth redirect | Unauthenticated visit to /dashboard → /welcome |
| Dashboard browse | /dashboard → tap event → detail sheet → Google Maps link |
| Settings | /settings → change region → /dashboard reloads |
| Ticket entry | /tickets → generate QR code → modal displays |
| Discover artists | /discover → search → follow → bubble appears |

### Page Object Model Structure

```
e2e/
  pages/
    welcome.page.ts
    artist-discovery.page.ts
    dashboard.page.ts
    settings.page.ts
    tickets.page.ts
  fixtures/
    auth.fixture.ts          ← reusable auth setup (storageState)
  tests/
    onboarding.spec.ts
    auth-redirect.spec.ts
    dashboard-browse.spec.ts
    settings.spec.ts
```

### POM Best Practices

- Each page class encapsulates locators and actions
- Tests read like user stories: `await dashboard.openEventDetail(0)`
- Use `data-testid` attributes for stable selectors (not CSS classes)
- Keep E2E tests few but high-value (cover critical paths only)
- Use Playwright's `storageState` for authenticated test sessions

---

## 9. Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Primary test approach (services) | DI Unit (`createTestContainer`) | Proven in codebase, fast, covers services/guards/interceptors |
| Primary test approach (components) | `createFixture` fluent API | Per [Aurelia 2 official docs](https://docs.aurelia.io/developer-guides/overview/testing-components): verifies view + view-model together |
| Mock strategy | Typed factories in `test/helpers/` | Type safety + reusability |
| Timer testing | `vi.useFakeTimers` in `beforeEach`, `vi.useRealTimers` in `afterEach` | Prevents timer leaks |
| E2E approach | Playwright POM, 4-6 critical journeys | Infrastructure already configured |
| Module-level side effects | `vi.mock()` + dynamic `await import()` | Already established pattern |
| Browser API mocking | `vi.spyOn` / `Object.defineProperty` / `vi.stubGlobal` | Per-API strategy |

---

## 10. Aurelia 2 Official Testing Documentation Reference

This strategy is aligned with the Aurelia 2 official testing documentation. Consult these pages for patterns and API details:

| Page | URL | Topics |
|------|-----|--------|
| Overview | [developer-guides/overview](https://docs.aurelia.io/developer-guides/overview) | Platform setup, TestContext, core concepts |
| Testing Components | [overview/testing-components](https://docs.aurelia.io/developer-guides/overview/testing-components) | createFixture, DOM assertions, event testing |
| Testing Attributes | [overview/testing-attributes](https://docs.aurelia.io/developer-guides/overview/testing-attributes) | Custom attribute testing, style assertions |
| Testing Value Converters | [overview/testing-value-converters](https://docs.aurelia.io/developer-guides/overview/testing-value-converters) | Unit + integration combination |
| Fluent API | [overview/fluent-api](https://docs.aurelia.io/developer-guides/overview/fluent-api) | Builder pattern, `.component().html().deps().build()` |
| Stubs, Mocks & Spies | [overview/mocks-spies](https://docs.aurelia.io/developer-guides/overview/mocks-spies) | Registration.instance(), DI mocking patterns |
| Advanced Techniques | [overview/advanced-testing](https://docs.aurelia.io/developer-guides/overview/advanced-testing) | Async, lifecycle hooks, accessibility, drag-and-drop |
| Outcome Recipes | [overview/outcome-recipes](https://docs.aurelia.io/developer-guides/overview/outcome-recipes) | API calls, router, forms, component interaction, lifecycle |
| Quick Reference | [developer-guides/overview](https://docs.aurelia.io/developer-guides/overview) | API cheat sheet, troubleshooting |
| Decision Trees | [developer-guides/overview](https://docs.aurelia.io/developer-guides/overview) | When to use which test approach |
