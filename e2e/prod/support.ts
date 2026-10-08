import * as fs from 'node:fs'
import * as path from 'node:path'
import type { APIRequestContext } from '@playwright/test'

/**
 * Production test data for the `open-a-shared-event-link` story: Events of a
 * test Organizer's Series for a test-only Artist, passed in by id.
 */
export const EVENTS = {
	/** An Event of a PUBLISHED PUBLIC Series. */
	public: process.env.E2E_EVENT_PUBLIC_ID ?? '',
	/** An Event of a PUBLISHED UNLISTED Series. */
	unlisted: process.env.E2E_EVENT_UNLISTED_ID ?? '',
	/** An Event of a CANCELLED (formerly PUBLIC) Series. */
	cancelled: process.env.E2E_EVENT_CANCELLED_ID ?? '',
	/** A not-yet-held Event of a PUBLISHED PUBLIC Series (its page offers sign-up). */
	upcoming: process.env.E2E_EVENT_UPCOMING_ID ?? '',
}

const API_BASE =
	process.env.PROD_API_BASE_URL ?? 'https://api.liverty-music.app'

/** The fields of a Concert the assertions read (Connect JSON shape). */
export interface ApiConcert {
	id: { value: string }
	series: { id: { value: string }; title: { value: string } }
	performers?: { id: { value: string }; name: { value: string } }[]
	listedVenueName?: { value: string }
	venue?: { name?: { value: string } }
}

async function call<T>(
	request: APIRequestContext,
	method: string,
	body: unknown,
): Promise<T> {
	const res = await request.post(
		`${API_BASE}/liverty_music.rpc.concert.v1.ConcertService/${method}`,
		{ data: body, headers: { 'content-type': 'application/json' } },
	)
	if (!res.ok()) {
		throw new Error(`${method} failed: ${res.status()} ${await res.text()}`)
	}
	return (await res.json()) as T
}

/** ConcertService.Get, as a guest. */
export async function getConcert(
	request: APIRequestContext,
	eventId: string,
): Promise<ApiConcert> {
	const res = await call<{ concert: ApiConcert }>(request, 'Get', {
		eventId: { value: eventId },
	})
	return res.concert
}

/** ConcertService.ListBySeries, as a guest. */
export async function listBySeries(
	request: APIRequestContext,
	seriesId: string,
): Promise<ApiConcert[]> {
	const res = await call<{ concerts?: ApiConcert[] }>(request, 'ListBySeries', {
		seriesId: { value: seriesId },
	})
	return res.concerts ?? []
}

/** The first `<meta property|name="key" content="…">` in served HTML. */
export function firstMeta(html: string, key: string): string | undefined {
	const re = new RegExp(
		`<meta\\s+(?:property|name)="${key.replace(/[:.]/g, '\\$&')}"\\s+content="([^"]*)"`,
	)
	return html
		.match(re)?.[1]
		?.replace(/&amp;/g, '&')
		.replace(/&#34;|&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
}

/** The prod E2E test user's credentials. */
export function testUser(): { username: string; password: string } {
	const username =
		process.env.E2E_USERNAME ?? 'e2e-test-password@liverty-music.app'
	const file = path.join(
		import.meta.dirname,
		'..',
		'..',
		'.auth',
		'password.prod.md',
	)
	const password =
		process.env.E2E_PASSWORD ??
		(fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').trim() : '')
	return { username, password }
}

/**
 * Fill a Zitadel Login V2 field and submit. The submit button stays disabled
 * until the Next.js page has hydrated, so re-fill until it enables.
 */
export async function fillAndSubmit(
	page: import('@playwright/test').Page,
	selector: string,
	value: string,
): Promise<void> {
	const input = page.locator(selector).first()
	await input.waitFor({ state: 'visible' })
	const submit = page.locator('button[type="submit"]:not([disabled])').first()
	for (let attempt = 0; attempt < 10; attempt++) {
		await input.fill(value)
		try {
			await submit.waitFor({ state: 'visible', timeout: 2_000 })
			await submit.click()
			return
		} catch {
			// not hydrated yet
		}
	}
	throw new Error(`submit never enabled for ${selector}`)
}
