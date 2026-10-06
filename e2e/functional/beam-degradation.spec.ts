import { fakeId } from '../support/fake-id'
import { expect, type Page, test } from '../support/test'

/**
 * A browser that cannot parse typed `attr()` drops the one declaration that
 * turns a card's beam name into a view timeline. This reproduces that browser
 * in Chromium by removing exactly that rule, and checks that the beams are
 * simply absent while the toggle, its persisted preference and the timetable
 * behave as they do with the effect off.
 */

const APP = 'http://localhost:9000'

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

async function mockRpc(page: Page): Promise<void> {
	const groups = Array.from({ length: 20 }, (_, i) => ({
		date: localDate(i + 1),
		home: [
			{
				id: { value: fakeId(`c-${i}`) },
				performers: [
					{
						id: { value: '00000000-0000-4000-8000-a00000000001' },
						name: { value: 'YOASOBI' },
						mbid: { value: '' },
					},
				],
				series: {
					id: { value: fakeId(`s-${i}`) },
					title: { value: 'Test Live' },
				},
				localDate: localDate(i + 1),
				venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
				sourceUrl: { value: 'https://example.com' },
			},
		],
		nearby: [],
		away: [],
	}))
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: route.request().url().includes('ListByArtists')
				? JSON.stringify({ groups })
				: '{}',
		}),
	)
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
}

/** Remove every rule that declares a view timeline from typed `attr()`. */
function dropTypedAttr(page: Page) {
	return page.evaluate(() => {
		let removed = 0
		const walk = (rules: CSSRuleList) => {
			for (let i = rules.length - 1; i >= 0; i--) {
				const rule = rules[i]
				if (
					rule instanceof CSSStyleRule &&
					/view-timeline:\s*attr\(/.test(rule.cssText)
				) {
					// `i` indexes the rule within its own parent (a grouping rule such as
					// `@layer` or `@scope`, or the sheet itself), so delete it from there.
					if (rule.parentRule) {
						;(rule.parentRule as CSSGroupingRule).deleteRule(i)
					} else {
						rule.parentStyleSheet?.deleteRule(i)
					}
					removed++
				} else if ('cssRules' in rule) {
					walk((rule as CSSGroupingRule).cssRules)
				}
			}
		}
		for (const sheet of document.styleSheets) {
			try {
				walk(sheet.cssRules)
			} catch {
				// Cross-origin sheet: not ours.
			}
		}
		return removed
	})
}

// @spec components/infrastructure/fan/web/global/live-highway "Beams are absent where unsupported, with nothing else affected"
test('beams are absent without typed attr(), and nothing else changes', async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('liverty:beams:enabled', 'false')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{
					artist: {
						id: '00000000-0000-4000-8000-a00000000001',
						name: 'YOASOBI',
						mbid: '',
					},
					hype: 'home',
				},
			]),
		)
	})
	await mockRpc(page)
	await page.goto(`${APP}/dashboard`)
	await page.locator('[data-live-card]').first().waitFor({ timeout: 10000 })

	// The browser without typed attr(): the rule is gone, and only that rule.
	expect(await dropTypedAttr(page)).toBe(1)

	const snapshot = () =>
		page.evaluate(() => ({
			groups: document.querySelectorAll('concert-highway .date-group').length,
			cards: document.querySelectorAll('[data-live-card]').length,
		}))
	const off = await snapshot()

	// The toggle is still offered and still persists the preference.
	await page.click('fab-menu .fab-toggle')
	const beamItem = page.locator('fab-menu .fab-item[data-action-id="beam"]')
	await expect(beamItem).toBeVisible()
	await beamItem.click()
	await expect
		.poll(() =>
			page.evaluate(() => localStorage.getItem('liverty:beams:enabled')),
		)
		.toBe('true')

	// No beam is drawn: no card declares a timeline, so every beam stays at its
	// collapsed base.
	const beams = await page.evaluate(() => ({
		declared: [
			...document.querySelectorAll<HTMLElement>('[data-live-card]'),
		].filter((c) => getComputedStyle(c).viewTimelineName !== 'none').length,
		lit: [...document.querySelectorAll<HTMLElement>('.laser-beam')].filter(
			(b) => b.getBoundingClientRect().height > 1,
		).length,
	}))
	expect(beams).toEqual({ declared: 0, lit: 0 })

	// The timetable renders and behaves as with the effect off.
	expect(await snapshot()).toEqual(off)
	await page.locator('[data-live-card]').first().click()
	await expect(
		page
			.locator('event-detail-sheet [role="dialog"], event-detail-sheet dialog')
			.first(),
	).toBeVisible()
})
