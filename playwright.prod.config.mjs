import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for verifying a story against PRODUCTION, as a guest and
 * signed in as the prod E2E test user.
 *
 * Not run by pull-request CI: it needs production test data (the ids of a
 * test Organizer's Events, passed in env vars) and a `storageState` from a
 * real OIDC login (`npm run auth:capture:password:prod` →
 * `.auth/storageState.prod.json`). Recorded in `docs/ci-coverage-gaps.md`.
 *
 * Usage:
 *   npm run auth:capture:password:prod          # once; needs .auth/password.prod.md
 *   E2E_EVENT_PUBLIC_ID=… E2E_EVENT_UNLISTED_ID=… E2E_EVENT_CANCELLED_ID=… \
 *     npm run test:e2e:prod
 *
 * `PROD_BASE_URL` / `PROD_API_BASE_URL` override the targets.
 */
const STORAGE_STATE = '.auth/storageState.prod.json'

export default defineConfig({
	testDir: './e2e/prod',
	timeout: 90 * 1000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: process.env.PROD_BASE_URL ?? 'https://liverty-music.app',
		trace: 'retain-on-failure',
		locale: 'ja-JP',
		timezoneId: 'Asia/Tokyo',
	},
	projects: [
		{
			name: 'prod-guest',
			testMatch: '**/*.guest.spec.ts',
			use: { ...devices['Pixel 7'] },
		},
		{
			name: 'prod-authenticated',
			testMatch: '**/*.authenticated.spec.ts',
			use: {
				...devices['Pixel 7'],
				// Required: the spec fails when it is missing (see its beforeAll).
				storageState: existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
				// A trace records every fill(), including the test user's real
				// password in the sign-up test; never write one for this project.
				trace: 'off',
				screenshot: 'off',
				video: 'off',
			},
		},
	],
})
