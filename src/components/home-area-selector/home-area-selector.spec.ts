import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REGION_GROUPS } from '../../constants/iso3166'
import { HomeAreaSelector } from './home-area-selector'

describe('HomeAreaSelector steps', () => {
	const original = document.startViewTransition
	let sut: HomeAreaSelector
	let content: HTMLElement
	let finish: () => void
	let seenWhileStarting: { stepping: boolean; root: boolean }[]

	beforeEach(() => {
		seenWhileStarting = []
		const logger = { scopeTo: () => logger, error: vi.fn(), warn: vi.fn() }
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, logger))
		sut = container.invoke(HomeAreaSelector)
		content = document.createElement('div')
		sut.stepContent = content
		Object.assign(document, {
			startViewTransition: (update: () => void) => {
				seenWhileStarting.push({
					stepping: 'stepping' in content.dataset,
					root: document.documentElement.classList.contains('vt-suppress-root'),
				})
				update()
				return {
					ready: Promise.resolve(),
					finished: new Promise<void>((resolve) => {
						finish = resolve
					}),
				}
			},
		})
	})

	afterEach(() => {
		Object.assign(document, { startViewTransition: original })
		document.documentElement.classList.remove('vt-suppress-root')
	})

	// @spec components/infrastructure/fan/web/global/app-shell "Drilling into a sheet's next level"
	it('swaps the regions and the prefectures inside a transition of the step, both ways', async () => {
		const region = REGION_GROUPS[0]
		sut.selectRegion(region)
		expect(sut.selectedRegion).toBe(region)
		expect(seenWhileStarting).toEqual([{ stepping: true, root: true }])

		finish()
		await Promise.resolve()
		await Promise.resolve()
		expect('stepping' in content.dataset).toBe(false)
		expect(
			document.documentElement.classList.contains('vt-suppress-root'),
		).toBe(false)

		sut.backToRegions()
		expect(sut.selectedRegion).toBeNull()
		expect(seenWhileStarting).toHaveLength(2)
	})

	it('still swaps the step where the browser has no View Transitions', () => {
		Object.assign(document, { startViewTransition: undefined })
		sut.selectRegion(REGION_GROUPS[0])
		expect(sut.selectedRegion).toBe(REGION_GROUPS[0])
	})
})
