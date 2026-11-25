import { expect, test } from '../support/test'

const TOKENS = 'components/infrastructure/fan/web/global/design-tokens'

test.use({ viewport: { width: 390, height: 844 } })

// @spec components/infrastructure/fan/web/global/design-tokens "A decorative loop under reduced motion"
test(`@spec ${TOKENS} "A decorative loop under reduced motion"`, async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'false')
		localStorage.setItem('guest.home', 'JP-13')
	})
	await page.goto('/discovery')
	await expect(page.locator('onboarding-progress')).toBeVisible({
		timeout: 30_000,
	})
	// The starfield does not twinkle, and the progress spark does not flare.
	await expect(page.locator('discovery-starfield')).toBeAttached()
	await expect(page.locator('.onboarding-progress-spark')).toBeAttached()
	const names = await page.evaluate(() =>
		[
			...document.querySelectorAll(
				'discovery-starfield, .onboarding-progress-spark',
			),
		].map((el) => getComputedStyle(el).animationName),
	)
	expect(names).toEqual(['none', 'none'])
})
