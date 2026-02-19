# Project Context & Architecture

## Overview

Liverty Music frontend — an Aurelia 2 single-page application (PWA target) for music fans to discover artists, follow live events, and manage their concert schedule.

| Stack            | Technology                                           |
|------------------|------------------------------------------------------|
| **Framework**    | Aurelia 2 (`aurelia`, `@aurelia/router`)              |
| **Build**        | Vite (`@aurelia/vite-plugin`)                         |
| **Styling**      | TailwindCSS v4 (`@tailwindcss/vite`)                  |
| **Linter**       | Biome (`@biomejs/biome`)                              |
| **Auth**         | Zitadel via `oidc-client-ts`                          |
| **Testing**      | Vitest + `@aurelia/testing`, Playwright (E2E)         |
| **Stories**      | Storybook (`@aurelia/storybook`)                      |

## File Organization

```
src/
  my-app.ts / .html          # Shell component + route definitions
  main.ts                     # Aurelia bootstrap + DI registrations
  routes/
    auth-callback.ts / .html  # OAuth callback handler
    artist-discovery/         # Onboarding discovery page
  components/
    auth-status.ts / .html    # Auth status display
    dna-orb/                  # Canvas-based artist discovery (Matter.js physics)
    toast-notification/       # Reusable toast notifications
  services/
    auth-service.ts           # Zitadel OIDC integration
    lastfm-service.ts         # Last.fm API client
    artist-discovery-service.ts # Discovery state management
```

## Aurelia 2 Best Practices

### These conventions are MANDATORY when writing code in this project.

### 1. Dependency Injection

Use `DI.createInterface` with `resolve()` for all services. Never use constructor injection with decorators.

```typescript
// Defining a service
export const IMyService = DI.createInterface<IMyService>(
  'IMyService',
  (x) => x.singleton(MyService),
)
export interface IMyService extends MyService {}

export class MyService {
  private readonly logger = resolve(ILogger).scopeTo('MyService')
  // ...
}
```

```typescript
// Consuming a service
export class MyComponent {
  private readonly myService = resolve(IMyService)
}
```

Register all services in `main.ts`:
```typescript
Aurelia
  .register(IMyService)
  .app(MyApp)
  .start()
```

### 2. Component Naming Convention

Use **convention-based** component registration — Aurelia 2 auto-discovers custom elements from matching `.ts` + `.html` file pairs. Do NOT use the `@customElement` decorator unless you need to override the default name.

```
my-component.ts    →  <my-component>
my-component.html  →  (template auto-associated)
```

### 3. Parent-Child Communication — Use `CustomEvent` + `.trigger`

**Do NOT use `.call` binding.** It is an Aurelia 1 pattern. Use standard DOM `CustomEvent` dispatching:

```typescript
// Child component — dispatch event
import { INode } from 'aurelia'

export class ChildComponent {
  private readonly element = resolve(INode) as HTMLElement

  private onSomethingHappened(data: SomeType): void {
    this.element.dispatchEvent(
      new CustomEvent('something-happened', {
        bubbles: true,
        detail: { data },
      })
    )
  }
}
```

```html
<!-- Parent template — listen with .trigger -->
<child-component something-happened.trigger="handleIt($event)">
```

```typescript
// Parent component — receive typed event
public handleIt(event: CustomEvent<{ data: SomeType }>): void {
  const data = event.detail.data
}
```

### 4. Lifecycle Hooks

Use the appropriate lifecycle hook for each concern:

| Hook          | Use For                                                    |
|---------------|------------------------------------------------------------|
| `loading()`   | Async data fetching in **routed** components (router hook) |
| `binding()`   | Setup before bindings activate (no DOM access)             |
| `bound()`     | React after bindings connect; trigger initial `propertyChanged` manually here |
| `attached()`  | DOM is ready — safe for measurements, canvas init, event listeners |
| `detaching()` | Cleanup — remove listeners, cancel animation frames, destroy physics |

**Always clean up in `detaching()`:** Remove event listeners, cancel `requestAnimationFrame`, destroy third-party instances.

### 5. `@bindable` Properties

Declare with `@bindable`. Use `[property]Changed(newVal, oldVal)` callbacks to react:

```typescript
export class MyComponent {
  @bindable public count = 0

  // Automatically called when `count` changes (NOT on initial creation)
  public countChanged(newVal: number, oldVal: number): void {
    // React to the change
  }
}
```

**Note:** Change callbacks do NOT fire during initial component creation. To run logic on the first value, call the handler manually in `bound()`.

### 6. Host Element Access

Use `INode` from Aurelia's DI to access the host element. Do NOT query the DOM manually:

```typescript
import { INode } from 'aurelia'

export class MyComponent {
  private readonly element = resolve(INode) as HTMLElement
}
```

### 7. Routing

Define routes with the `@route` decorator on the shell component using lazy `import()`:

```typescript
@route({
  routes: [
    {
      path: 'my-page',
      component: import('./routes/my-page/my-page'),
      title: 'My Page',
    },
  ],
})
export class MyApp {}
```

Use `resolve(IRouter)` and `router.load('path')` for programmatic navigation.

### 8. Template Syntax Quick Reference

```html
<!-- Text interpolation -->
${expression}

<!-- Property binding (one-way to view) -->
<div class-name.bind="value">

<!-- Two-way binding (forms) -->
<input value.bind="name">

<!-- Event binding -->
<button click.trigger="handleClick($event)">

<!-- Conditional rendering -->
<div if.bind="showIt">

<!-- List rendering -->
<div repeat.for="item of items">

<!-- Element reference -->
<canvas ref="myCanvas">

<!-- Component import (local registration) -->
<import from="./components/my-component">
```

### 9. Value Converters (when needed)

```typescript
import { valueConverter } from 'aurelia'

@valueConverter('formatDate')
export class FormatDateValueConverter {
  public toView(value: Date, format?: string): string {
    // transform for display
  }
}
```

```html
${someDate | formatDate:'short'}
```

### 10. Logging

Always use Aurelia's `ILogger` with `scopeTo()` — never use `console.log`:

```typescript
private readonly logger = resolve(ILogger).scopeTo('ComponentName')

this.logger.info('Something happened', { context: data })
this.logger.warn('Potential issue', error)
this.logger.error('Failed operation', error)
```

## Playwright MCP (Authenticated E2E Testing)

All routes require authentication by default (`AuthHook` in `src/hooks/auth-hook.ts`). Public routes explicitly set `data: { auth: false }` in route config.

Before using the `playwright-auth` MCP server to test protected routes:

```bash
npx tsx scripts/capture-auth-state.ts
```

This opens a browser for manual OIDC login and saves the session to `.auth/storageState.json`. The `playwright-auth` MCP server (configured in `.claude/settings.json`) uses this file automatically.

If navigation to a protected route redirects to `/`, the storageState has likely expired. Re-run the capture script.

## Development Commands

```bash
# Development server
npm start

# Production build
npm run build

# Lint
npx @biomejs/biome check src/

# Unit tests
npx vitest

# E2E tests
npx playwright test

# Storybook
npm run storybook
```

## Key Technical Decisions

### 1. Canvas + Matter.js for Artist Discovery

The artist discovery bubble UI uses HTML5 Canvas 2D with Matter.js physics engine. This was chosen over DOM-based animation for performance with 30+ animated elements on mobile. See `src/components/dna-orb/`.

### 2. Direct Last.fm API Calls

Last.fm API is called directly from the frontend (client-side). The API key is public/read-only by design. Calls use 300ms debounce and in-memory caching.

### 3. Service-Based State (No External State Library)

State is managed through singleton DI services, not Redux/MobX. Aurelia's DI container provides clean lifecycle management. External state libraries are over-engineering for the current scope.

### 4. Onboarding Flow via localStorage Flag

New vs returning users are distinguished by `localStorage.getItem('liverty:onboarding_complete')`. The auth callback checks this flag to route users to artist discovery or the dashboard.
