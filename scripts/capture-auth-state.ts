/**
 * Captures an authenticated browser session's storageState for Playwright MCP use.
 *
 * Usage:
 *   npx tsx scripts/capture-auth-state.ts
 *
 * Prerequisites:
 *   - The frontend dev server must be running (npm start)
 *   - A test user account must exist in the Zitadel instance
 *
 * Environment variables (optional, for non-interactive mode):
 *   - E2E_USERNAME: Test user email
 *   - E2E_PASSWORD: Test user password
 *
 * The script opens a browser, navigates to the app, and waits for the user
 * to complete the OIDC login flow. Once authenticated, it saves the browser
 * state to .auth/storageState.json for use with Playwright MCP.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from '@playwright/test'

const APP_URL = process.env.APP_URL || 'http://localhost:9000'
const OUTPUT_DIR = path.join(import.meta.dirname, '..', '.auth')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'storageState.json')

async function captureAuthState(): Promise<void> {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true })

	const browser = await chromium.launch({ headless: false })
	const context = await browser.newContext()
	const page = await context.newPage()

	// Set timeout to 5 minutes for manual login
	page.setDefaultTimeout(300_000)

	console.log(`Navigating to ${APP_URL}...`)
	await page.goto(APP_URL)

	console.log('Please complete the login flow in the browser window.')
	console.log('Waiting for authentication to complete...')
	console.log('(Checking storage every 1 second for oidc.user: key...)')
	console.log(
		'⚠️  DO NOT CLOSE THE BROWSER - wait for "Storage state saved" message',
	)

	// Wait for the app to redirect after successful OIDC login.
	// oidc-client-ts can use either localStorage or sessionStorage.
	// Some intermediate pages (Zitadel Login V2 UI, about:blank during redirects)
	// throw SecurityError when reading storage — swallow those and keep polling.
	await page.waitForFunction(
		() => {
			try {
				const localKeys = Object.keys(localStorage)
				const sessionKeys = Object.keys(sessionStorage)
				const userKey =
					localKeys.find((key) => key.startsWith('oidc.user:')) ||
					sessionKeys.find((key) => key.startsWith('oidc.user:'))
				if (!userKey) {
					console.log(
						`[${new Date().toISOString()}] localStorage:`,
						localKeys.join(', ') || '(empty)',
					)
					console.log(
						`[${new Date().toISOString()}] sessionStorage:`,
						sessionKeys.join(', ') || '(empty)',
					)
				}
				return userKey !== undefined
			} catch {
				return false
			}
		},
		{ polling: 1000 }, // Check every 1 second (timeout set at page level)
	)

	console.log('Authentication detected. Saving storage state...')

	await context.storageState({ path: OUTPUT_PATH })

	console.log(`Storage state saved to ${OUTPUT_PATH}`)
	console.log('You can now use this with Playwright MCP:')
	console.log('  --isolated --storage-state=.auth/storageState.json')

	await browser.close()
}

captureAuthState().catch((err) => {
	console.error('Failed to capture auth state:', err)
	process.exit(1)
})
