import { installConsole } from '../support/organizer'
import type { Page } from '../support/test'
import { expect, test } from '../support/test'

/**
 * Console colors follow the operating system's appearance: light by default,
 * dark when the system is dark, switching without a reload.
 */

/** Relative luminance of a computed `color(srgb …)` / `rgb(…)` value. */
async function luminanceOf(
	page: Page,
	selector: string,
	property: 'color' | 'backgroundColor',
): Promise<number> {
	return page
		.locator(selector)
		.first()
		.evaluate((el, prop) => {
			// Resolve any color syntax to sRGB through a canvas.
			const canvas = document.createElement('canvas')
			canvas.width = canvas.height = 1
			const ctx = canvas.getContext('2d')
			if (!ctx) throw new Error('no 2d context')
			ctx.fillStyle = getComputedStyle(el)[prop as 'color']
			ctx.fillRect(0, 0, 1, 1)
			const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
			const lin = (v: number) => {
				const c = v / 255
				return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
			}
			return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
		}, property)
}

async function openConcerts(page: Page): Promise<void> {
	await installConsole(page)
	await page.goto('/concerts')
	await expect(page.locator('organizer-shell h1').first()).toBeVisible()
}

test.describe('console appearance', () => {
	test('@spec components/infrastructure/organizer/web/global/design-tokens "Office PC in light mode"', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.emulateMedia({ colorScheme: 'light' })
		await openConcerts(page)

		expect(await luminanceOf(page, 'body', 'backgroundColor')).toBeGreaterThan(
			0.8,
		)
		expect(await luminanceOf(page, 'body', 'color')).toBeLessThan(0.05)
	})

	test('@spec components/infrastructure/organizer/web/global/design-tokens "Phone in dark mode"', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await page.emulateMedia({ colorScheme: 'dark' })
		await openConcerts(page)

		expect(await luminanceOf(page, 'body', 'backgroundColor')).toBeLessThan(
			0.05,
		)
		expect(await luminanceOf(page, 'body', 'color')).toBeGreaterThan(0.7)
		// Form controls and scrollbars follow the used color scheme, which is
		// dark here: the page declares both schemes and the system picks dark.
		const scheme = await page.evaluate(
			() => getComputedStyle(document.documentElement).colorScheme,
		)
		expect(scheme).toBe('light dark')
		const fieldLuminance = await page.evaluate(() => {
			const input = document.createElement('input')
			input.style.all = 'revert'
			document.body.append(input)
			const canvas = document.createElement('canvas')
			const ctx = canvas.getContext('2d')
			if (!ctx) throw new Error('no 2d context')
			ctx.fillStyle = getComputedStyle(input).backgroundColor
			ctx.fillRect(0, 0, 1, 1)
			const [r] = ctx.getImageData(0, 0, 1, 1).data
			input.remove()
			return r
		})
		// The browser's own field background is dark under a dark scheme.
		expect(fieldLuminance).toBeLessThan(128)
	})

	test('@spec components/infrastructure/organizer/web/global/design-tokens "System switches while the console is open"', async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: 'light' })
		await openConcerts(page)
		// A marker on window survives only if the page is not reloaded.
		await page.evaluate(() => {
			;(window as unknown as { __noReload: boolean }).__noReload = true
		})
		expect(await luminanceOf(page, 'body', 'backgroundColor')).toBeGreaterThan(
			0.8,
		)

		await page.emulateMedia({ colorScheme: 'dark' })

		await expect
			.poll(() => luminanceOf(page, 'body', 'backgroundColor'))
			.toBeLessThan(0.05)
		expect(
			await page.evaluate(
				() => (window as unknown as { __noReload?: boolean }).__noReload,
			),
		).toBe(true)
	})
})
