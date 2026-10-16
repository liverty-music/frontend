import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The dashboard's laser beam toggle in the FAB action launcher: off by
 * default, persisted under `beams.enabled`, restored on reload, and offered
 * only as a launcher item with the spotlight icon and a label.
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/fab-menu'
const ARTIST_ID = '00000000-0000-4000-8000-a00000000001'

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

async function mockRpc(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		if (!route.request().url().includes('ListByArtists')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{}',
			})
		}
		const groups = Array.from({ length: 5 }, (_, i) => ({
			date: localDate(i + 1),
			home: [
				{
					id: { value: fakeId(`fab-c-${i}`) },
					performers: [
						{
							id: { value: ARTIST_ID },
							name: { value: 'YOASOBI' },
							mbid: { value: '' },
						},
					],
					series: {
						id: { value: fakeId(`fab-s-${i}`) },
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
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(concertWire({ groups })),
		})
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
}

/** Open My Timetable as a guest; `beams` seeds `beams.enabled` when given. */
async function openDashboard(page: Page, beams?: 'true' | 'false') {
	await page.addInitScript(
		({ beams, artistId }) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			if (beams === undefined) localStorage.removeItem('beams.enabled')
			else if (!sessionStorage.getItem('__beams_seeded')) {
				sessionStorage.setItem('__beams_seeded', '1')
				localStorage.setItem('beams.enabled', beams)
			}
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: artistId, name: 'YOASOBI', mbid: '' }, hype: 'home' },
				]),
			)
		},
		{ beams, artistId: ARTIST_ID },
	)
	await mockRpc(page)
	await page.goto('/dashboard')
	await page.locator('[data-live-card]').first().waitFor({ timeout: 20_000 })
}

const beamItem = (page: Page) =>
	page.locator('fab-menu .fab-item[data-action-id="beam"]')

async function openLauncher(page: Page) {
	if (!(await beamItem(page).isVisible())) {
		await page.click('fab-menu .fab-toggle')
	}
	await expect(beamItem(page)).toBeVisible()
}

const beamsStored = (page: Page) =>
	page.evaluate(() => localStorage.getItem('beams.enabled'))

test(`@spec ${CAPABILITY} "Default state is off on first visit"`, async ({
	page,
}) => {
	await openDashboard(page)

	expect(await beamsStored(page)).toBeNull()
	await expect(page.locator('.laser-beam')).toHaveCount(0)
	await openLauncher(page)
	await expect(beamItem(page)).toHaveAttribute('aria-pressed', 'false')
})

test(`@spec ${CAPABILITY} "Enabling the beam effect"`, async ({ page }) => {
	await openDashboard(page, 'false')
	await openLauncher(page)

	await beamItem(page).click()

	await expect(page.locator('.laser-beam').first()).toBeAttached()
	await expect.poll(() => beamsStored(page)).toBe('true')
	await openLauncher(page)
	await expect(beamItem(page)).toHaveAttribute('aria-pressed', 'true')
})

test(`@spec ${CAPABILITY} "Disabling the beam effect"`, async ({ page }) => {
	await openDashboard(page, 'true')
	await expect(page.locator('.laser-beam').first()).toBeAttached()
	await openLauncher(page)

	await beamItem(page).click()

	await expect(page.locator('.laser-beam')).toHaveCount(0)
	await expect.poll(() => beamsStored(page)).toBe('false')
	await openLauncher(page)
	await expect(beamItem(page)).toHaveAttribute('aria-pressed', 'false')
})

test(`@spec ${CAPABILITY} "Preference is restored on page reload"`, async ({
	page,
}) => {
	await openDashboard(page, 'false')
	await openLauncher(page)
	await beamItem(page).click()
	await expect.poll(() => beamsStored(page)).toBe('true')

	await page.reload()
	await page.locator('[data-live-card]').first().waitFor({ timeout: 20_000 })

	// On without any interaction.
	await expect(page.locator('.laser-beam').first()).toBeAttached()
	expect(await beamsStored(page)).toBe('true')
})

test(`@spec ${CAPABILITY} "Toggle button placement and icon"`, async ({
	page,
}) => {
	await openDashboard(page, 'false')
	await openLauncher(page)

	const item = beamItem(page)
	expect(await iconName(item)).toBe('spotlight')
	await expect(item.locator('.fab-item-label')).toHaveText(/\S/)
	await expect(item).toHaveAttribute('aria-pressed', 'false')
	// Not a button in the page header.
	await expect(
		page.locator('page-header button', {
			hasText: await item.locator('.fab-item-label').innerText(),
		}),
	).toHaveCount(0)
	for (const icon of await page.locator('page-header svg-icon').all()) {
		expect(await iconName(icon)).not.toBe('spotlight')
	}
})

/** The `name` bound on an `<svg-icon>`: `scope` itself or the first inside it. */
async function iconName(scope: ReturnType<Page['locator']>): Promise<string> {
	const isIcon = await scope.evaluate(
		(el) => el.tagName.toLowerCase() === 'svg-icon',
	)
	const icon = isIcon ? scope : scope.locator('svg-icon').first()
	return icon.evaluate(
		(el) =>
			(
				el as HTMLElement & {
					$au?: Record<string, { viewModel?: { name?: string } }>
				}
			).$au?.['au:resource:custom-element']?.viewModel?.name ?? '',
	)
}
