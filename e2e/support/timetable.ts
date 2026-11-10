import type { Page } from '@playwright/test'
import { concertWire } from './concert-wire'
import { fakeId } from './fake-id'

/**
 * The dashboard's timetable on a mocked backend, for specs about how it moves:
 * a guest following one artist, with a concert every other day for 100 days
 * (four months of dates), each in the HOME lane.
 */

const ARTIST = '00000000-0000-4000-8000-a00000000001'

export function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

export const dateKey = (offset: number) => {
	const { year, month, day } = localDate(offset).value
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** A concert every other day for 100 days: four months of dates. */
export const OFFSETS = Array.from({ length: 50 }, (_, i) => 1 + i * 2)

function groups() {
	return OFFSETS.map((day) => ({
		date: localDate(day),
		home: [
			{
				id: { value: fakeId(`h-${day}`) },
				performers: [
					{
						id: { value: ARTIST },
						name: { value: 'ARTIST' },
						mbid: { value: '' },
					},
				],
				series: { id: { value: fakeId(`s-${day}`) }, title: { value: 'Live' } },
				localDate: localDate(day),
				venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
				sourceUrl: { value: 'https://example.com' },
			},
		],
		nearby: [],
		away: [],
	}))
}

export async function openDashboard(page: Page): Promise<void> {
	await page.addInitScript((artist) => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ artist: { id: artist, name: 'ARTIST', mbid: '' }, hype: 'home' },
			]),
		)
	}, ARTIST)
	const body = JSON.stringify(concertWire({ groups: groups() }))
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		const listed =
			url.includes('ListByArtists') || url.includes('ListByLocation')
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: listed ? body : '{}',
		})
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await page.goto('/dashboard')
	await page.locator('[data-live-card]').first().waitFor({ timeout: 15_000 })
	await frames(page)
}

export function frames(page: Page, n = 4): Promise<void> {
	return page.evaluate(
		(count) =>
			new Promise<void>((r) => {
				let i = 0
				const tick = () => (++i >= count ? r() : requestAnimationFrame(tick))
				requestAnimationFrame(tick)
			}),
		n,
	)
}

/** Scroll the timetable as a finger does: no smooth scrolling. */
export async function scrollBy(page: Page, top: number): Promise<void> {
	await page.evaluate((y) => {
		const s = document.querySelector(
			'concert-highway .concert-scroll',
		) as HTMLElement
		s.scrollBy({ top: y, behavior: 'instant' })
	}, top)
	await frames(page)
}

/** The date group at the top edge of the timetable. */
export function topDate(page: Page): Promise<string | undefined> {
	return page.evaluate(() => {
		const scroll = document.querySelector(
			'concert-highway .concert-scroll',
		) as HTMLElement
		const edge = scroll.getBoundingClientRect().top
		return [...scroll.querySelectorAll<HTMLElement>('[data-date-key]')].find(
			(g) => g.getBoundingClientRect().bottom > edge + 0.5,
		)?.dataset.dateKey
	})
}
