import { gunzipSync } from 'node:zlib'
import type { Page, Route } from './test'

/**
 * Fan-app helpers for specs that assert on the usage events the app sends to
 * PostHog: a `/config.json` that turns analytics on, a client posthog-js does
 * not take for a bot, and a PostHog host that answers locally and records
 * every event it receives. No traffic leaves the machine.
 */

const API_HOST = 'https://eu.i.posthog.com'

/** One event as PostHog's ingest endpoint received it. */
export interface SentEvent {
	event: string
	properties: Record<string, unknown>
	timestamp?: string
}

/**
 * Serve the app's own `/config.json` with a PostHog project key, so
 * AnalyticsService loads the SDK instead of running without one.
 */
export async function enableAnalytics(page: Page): Promise<void> {
	await page.route('**/config.json', async (route) => {
		const response = await route.fetch()
		const config = (await response.json()) as Record<string, unknown>
		await route.fulfill({
			response,
			json: {
				...config,
				posthogApiHost: API_HOST,
				posthogProjectKey: 'phc_e2e_test',
				internalTrafficUserIds: [],
			},
		})
	})
	await looksLikeABrowser(page)
}

/**
 * posthog-js drops every capture for an automation client: it reads
 * `navigator.webdriver` and `navigator.userAgentData.brands` ("HeadlessChrome").
 * Clear both so the SDK captures as it would for a fan.
 */
async function looksLikeABrowser(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'webdriver', {
			get: () => false,
			configurable: true,
		})
		const nav = navigator as unknown as { userAgentData?: unknown }
		if (nav.userAgentData) {
			const brands = [
				{ brand: 'Chromium', version: '145' },
				{ brand: 'Google Chrome', version: '145' },
				{ brand: 'Not:A-Brand', version: '99' },
			]
			Object.defineProperty(nav, 'userAgentData', {
				get: () => ({
					brands,
					mobile: false,
					platform: 'Windows',
					getHighEntropyValues: async () => ({ brands }),
				}),
				configurable: true,
			})
		}
	})
}

/** posthog-js's event ingest paths (`/e/`, `/i/v0/e/`, `/batch/`, `/capture/`). */
const INGEST_PATH = /\/(e|i\/v0\/e|batch|capture)\/?(\?|$)/

/**
 * Answer every PostHog request locally and record the events sent to the
 * ingest endpoints, in arrival order. Remote config and flags answer empty,
 * so no recording or feature flag starts.
 */
export async function recordPostHog(page: Page): Promise<SentEvent[]> {
	const events: SentEvent[] = []
	await page.route(`${API_HOST}/**`, (route: Route) => {
		const request = route.request()
		if (INGEST_PATH.test(request.url())) {
			events.push(...decodeEvents(request.postDataBuffer()))
			return route.fulfill({ json: { status: 1 } })
		}
		if (request.url().includes('/flags')) {
			return route.fulfill({
				json: {
					featureFlags: {},
					featureFlagPayloads: {},
					sessionRecording: false,
				},
			})
		}
		return route.fulfill({ json: {} })
	})
	return events
}

/**
 * The events in an ingest body: gzip, a `data=<base64>` form field, or JSON,
 * holding one event, an array, or `{ batch: [...] }`.
 */
function decodeEvents(body: Buffer | null): SentEvent[] {
	if (!body || body.length === 0) return []
	let text: string
	if (body[0] === 0x1f && body[1] === 0x8b) {
		text = gunzipSync(body).toString('utf8')
	} else {
		text = body.toString('utf8')
		const data = new URLSearchParams(text).get('data')
		if (data) text = Buffer.from(data, 'base64').toString('utf8')
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return []
	}
	const list = Array.isArray(parsed)
		? parsed
		: ((parsed as { batch?: unknown[] }).batch ?? [parsed])
	return list.filter(
		(e): e is SentEvent => typeof (e as SentEvent | null)?.event === 'string',
	)
}

/** The sent events named `name`. */
export function named(events: SentEvent[], name: string): SentEvent[] {
	return events.filter((e) => e.event === name)
}
