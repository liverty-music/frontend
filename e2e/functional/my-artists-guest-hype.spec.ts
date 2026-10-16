import { fakeId } from '../support/fake-id'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * A guest's hype change on My Artists: kept in the artist's entry of
 * `guest.followedArtists`, never reverted, and decoupled from onboarding.
 */

const CAPABILITY = 'components/infrastructure/fan/web/route/my-artists'

const A = { id: fakeId('hype-artist-a'), name: 'Artist A', mbid: '' }
const B = { id: fakeId('hype-artist-b'), name: 'Artist B', mbid: '' }

type Hype = 'watch' | 'home' | 'nearby' | 'away'

async function open(page: Page, onboardingComplete: 'true' | 'false') {
	await page.addInitScript(
		({ entries, onboardingComplete }) => {
			if (sessionStorage.getItem('__seeded')) return
			sessionStorage.setItem('__seeded', '1')
			localStorage.setItem('onboardingComplete', onboardingComplete)
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('onboarding.helpSeen:my-artists', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem('guest.followedArtists', JSON.stringify(entries))
		},
		{
			entries: [
				{ artist: A, hype: 'nearby' },
				{ artist: B, hype: 'nearby' },
			],
			onboardingComplete,
		},
	)
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await page.goto('/my-artists')
	await expect(page.locator('[data-artist-rows] .artist-row')).toHaveCount(2, {
		timeout: 20_000,
	})
}

/** Pick a hype level on the n-th artist row. */
async function setHype(page: Page, row: number, hype: Hype) {
	await page.evaluate(
		({ row, hype }) => {
			const tr = document.querySelectorAll('[data-artist-rows] .artist-row')[
				row
			]
			const dots = [...tr.querySelectorAll<HTMLElement>('.hype-dot')]
			const index = dots.findIndex((d) => d.dataset.level === hype)
			tr.querySelectorAll<HTMLInputElement>('input[type="radio"]')[
				index
			].dispatchEvent(new Event('change', { bubbles: true }))
		},
		{ row, hype },
	)
}

const stored = async (page: Page): Promise<Record<string, Hype>> => {
	const raw = await page.evaluate(() =>
		localStorage.getItem('guest.followedArtists'),
	)
	const entries = JSON.parse(raw ?? '[]') as {
		artist: { id: string }
		hype: Hype
	}[]
	return Object.fromEntries(entries.map((e) => [e.artist.id, e.hype]))
}

const activeLevel = (page: Page, row: number) =>
	page
		.locator('[data-artist-rows] .artist-row')
		.nth(row)
		.locator('.hype-dot[data-active="true"]')

const onboardingFlag = (page: Page) =>
	page.evaluate(() => localStorage.getItem('onboardingComplete'))

test(`@spec ${CAPABILITY} "Guest user changes hype during onboarding"`, async ({
	page,
}) => {
	await open(page, 'false')
	await expect(page.locator('signup-prompt-banner aside')).toBeVisible()

	await setHype(page, 0, 'away')

	await expect
		.poll(() => stored(page))
		.toEqual({ [A.id]: 'away', [B.id]: 'nearby' })
	await expect(activeLevel(page, 0)).toHaveAttribute('data-level', 'away')
	// Onboarding is untouched: no step advance, no completion.
	expect(await onboardingFlag(page)).toBe('false')
	await expect(page).toHaveURL(/\/my-artists$/)
	await expect(page.locator('signup-prompt-banner aside')).toBeVisible()
})

test(`@spec ${CAPABILITY} "Repeated hype change applies every time"`, async ({
	page,
}) => {
	await open(page, 'false')

	await setHype(page, 0, 'home')
	await expect
		.poll(() => stored(page))
		.toEqual({ [A.id]: 'home', [B.id]: 'nearby' })
	await setHype(page, 0, 'watch')
	await expect
		.poll(() => stored(page))
		.toEqual({ [A.id]: 'watch', [B.id]: 'nearby' })
	await setHype(page, 1, 'away')
	await expect
		.poll(() => stored(page))
		.toEqual({ [A.id]: 'watch', [B.id]: 'away' })

	await expect(activeLevel(page, 0)).toHaveAttribute('data-level', 'watch')
	await expect(activeLevel(page, 1)).toHaveAttribute('data-level', 'away')
	expect(await onboardingFlag(page)).toBe('false')
})

test(`@spec ${CAPABILITY} "Guest user changes hype after onboarding completion"`, async ({
	page,
}) => {
	await open(page, 'true')

	await setHype(page, 1, 'home')

	await expect
		.poll(() => stored(page))
		.toEqual({ [A.id]: 'nearby', [B.id]: 'home' })
	await expect(activeLevel(page, 1)).toHaveAttribute('data-level', 'home')
	// No modal dialog; the signup banner stays.
	await expect(page.locator('dialog[open]')).toHaveCount(0)
	await expect(page.locator('signup-prompt-banner aside')).toBeVisible()
})
