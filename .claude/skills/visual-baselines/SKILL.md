---
name: visual-baselines
description: Component-level visual regression with Vitest browser toMatchScreenshot - regenerating and committing screenshot baselines inside the pinned Playwright container, and reading storybook-test CI failures. Use when a visual change requires updating baselines or a visual test fails.
---

### Visual regression

Component-level only, via Vitest browser `expect.element(el).toMatchScreenshot()` (pixelmatch,
`allowedMismatchedPixelRatio: 0.001`) on the static design-system subset (svg-icon, inline-error,
state-placeholder, page-header). Baselines are **committed** under
`src/components/*/__screenshots__/**/*-chromium-linux.png` and reviewed in the PR diff (no CI artifact).

- Generate/compare baselines INSIDE the pinned container so rendering is deterministic with CI:
  ```bash
  # regenerate after an intentional visual change, then commit the PNGs
  docker run --rm -v "$PWD":/work -w /work -e HOME=/tmp \
    mcr.microsoft.com/playwright:v1.63.0-noble \
    npx vitest run --project=storybook --update
  ```
- The `storybook-test` CI job runs in that same image; on failure it uploads the Vitest HTML report
  (`storybook-test-report/`, which embeds the diff/actual images). Page-level visual regression
  (the old Playwright `mobile-visual`) has been retired — one visual pipeline only.
