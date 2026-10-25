import { mockFanRpc } from '../support/fan-auth'
import {
	enableAnalytics,
	named,
	recordPostHog,
	snapshotsOf,
} from '../support/posthog'
import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The recording the fan app makes with its bundled recorder, read back from
 * what it sends to PostHog. PostHog and the backend are mocked.
 */

const SPEC = 'components/infrastructure/fan/web/global/analytics'

/** Every string of a serialized rrweb node tree under `key`. */
function stringsUnder(
	value: unknown,
	key: string,
	out: string[] = [],
): string[] {
	if (Array.isArray(value)) {
		for (const item of value) stringsUnder(item, key, out)
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			if (k === key && typeof v === 'string') out.push(v)
			else stringsUnder(v, key, out)
		}
	}
	return out
}

/** Every attribute value of a serialized rrweb node tree, by name. */
function attributes(value: unknown, out = new Map<string, string[]>()) {
	if (Array.isArray(value)) {
		for (const item of value) attributes(item, out)
	} else if (value && typeof value === 'object') {
		const attrs = (value as { attributes?: unknown }).attributes
		if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
			for (const [name, v] of Object.entries(attrs)) {
				if (typeof v === 'string') out.set(name, [...(out.get(name) ?? []), v])
			}
		}
		for (const v of Object.values(value)) attributes(v, out)
	}
	return out
}

test(`@spec ${SPEC} "Masked text"`, async ({ page }) => {
	await mockFanRpc(page)
	await enableAnalytics(page)
	const events = await recordPostHog(page, { recording: true })

	await page.goto('/welcome?ref=member-a')
	await expect
		.poll(() => named(events, '$pageview').length, { timeout: 20_000 })
		.toBeGreaterThan(0)
	// The SDK holds a recording until the visitor interacts.
	for (let i = 0; i < 5; i++) {
		await page.mouse.move(100 + i * 40, 300 + i * 20)
		await page.mouse.wheel(0, 200)
	}
	await expect
		.poll(() => snapshotsOf(events).some((s) => s.type === 2), {
			timeout: 20_000,
		})
		.toBe(true)

	const snapshots = snapshotsOf(events)
	const recorded = JSON.stringify(snapshots)
	// The text on screen is masked: the heading the fan reads is not in the
	// recording, and masked text nodes are.
	const heading = (await page.locator('h1').first().innerText()).trim()
	expect(heading.length).toBeGreaterThan(0)
	expect(recorded).not.toContain(heading)
	expect(
		stringsUnder(snapshots, 'textContent').some((t) => /^\*+$/.test(t.trim())),
	).toBe(true)
	const attrs = attributes(snapshots)
	expect(attrs.get('aria-label')?.length ?? 0).toBeGreaterThan(0)
	for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
		for (const value of attrs.get(name) ?? []) {
			expect(value, `${name} is masked`).toMatch(/^\**$/)
		}
	}
	// No referral code anywhere in the recording.
	expect(recorded).not.toContain('member-a')
})
