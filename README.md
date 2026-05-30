# liverty-music

This project is bootstrapped by [aurelia/new](https://github.com/aurelia/new).

## Quick start

    npm install
    npm start

Run unit tests:

    npm test
Run Storybook:

    npm run storybook
Run Playwright e2e:

    npx playwright install --with-deps
    npx playwright test

## TailwindCSS Integration

This project includes TailwindCSS for utility-first CSS styling. TailwindCSS allows you to rapidly build custom user interfaces using low-level utility classes.

### Using TailwindCSS

TailwindCSS is automatically configured and ready to use. You can use any TailwindCSS utility classes in your HTML templates and components.

Example:
```html
<div class="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden">
  <div class="p-8">
    <h1 class="text-2xl font-bold text-gray-900">Hello TailwindCSS!</h1>
    <p class="text-gray-600">Build amazing UIs with utility classes.</p>
  </div>
</div>
```

### Customizing TailwindCSS

To customize your TailwindCSS configuration, create a `tailwind.config.js` file in your project root:

```js
module.exports = {
  theme: {
    extend: {
      colors: {
        'brand-blue': '#1fb6ff',
        'brand-purple': '#7e5bef',
      },
    },
  },
  plugins: [],
}
```

### TailwindCSS Resources

- [TailwindCSS Documentation](https://tailwindcss.com/docs)
- [TailwindCSS Cheat Sheet](https://tailwindcomponents.com/cheatsheet/)
- [Tailwind Components](https://tailwindui.com/)

## Start dev web server

    npm start

## Build the app in production mode

    npm run build


## Unit Tests

    npm run test

Run unit tests in watch mode.

    npm run test:watch


## Playwright e2e test

You may need to install playwright test browsers if have not.

   npx playwright install --with-deps

All e2e tests are in `e2e/`.

Run e2e tests with:

    npm run test:e2e

Note the playwright config automatically runs "npm start" before playwright.

For more information, visit https://playwright.dev/docs/test-cli

## Deployment Pipeline

Container images are built and promoted by `.github/workflows/push-image.yaml`:

- **Push to `main`** → dev Artifact Registry (`liverty-music-dev/frontend`). Every push runs the workflow; a per-run decision over the changed files picks one of:
  - **build** — when a build-relevant file changed (`src/**`, `public/**`, `scripts/**`, `package.json`, `package-lock.json`, `vite.config.ts`, `Dockerfile`, `Caddyfile`, or the workflow itself): `web-app` is rebuilt and pushed as `:latest`, `:main`, `:<sha>`.
  - **inherit** — when nothing build-relevant changed (docs/CI only): no rebuild; the parent commit's digest is `crane copy`-ed onto `:<sha>`. This guarantees **every `main` commit has a resolvable dev `:<sha>` image**, so a release can be cut on `main` HEAD at any time.
- **GitHub Release** → prod Artifact Registry (`liverty-music-prod/frontend`). The release path never rebuilds — it promotes the exact dev `:<sha>` digest to prod via `crane copy` (byte-identical to what ran in dev). The bundle is env-agnostic; per-environment values come from `/config.json` at runtime.

See `cloud-provisioning/docs/runbooks/prod-image-tag-pinning.md` for the retag-failure recovery runbook.
