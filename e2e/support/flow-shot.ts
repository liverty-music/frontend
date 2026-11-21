import { test } from './test'

/**
 * A screenshot of what the fan sees at one step of a user story, attached to
 * the HTML report under a step named after it. Tests tagged `@flow` call it at
 * the steps worth looking at; `npm run e2e:flows` runs them at a phone size so
 * a person can page through each story's screens in order
 * (`npx playwright show-report`).
 */
export async function flowShot(
	page: import('@playwright/test').Page,
	name: string,
): Promise<void> {
	await test.step(`screen: ${name}`, async () => {
		// A screen as it settles: wait for the motions that end (a dialog's
		// fade-in, a sheet sliding up); the looping ones (a guide moment's
		// glow) never end and are shot as they are.
		await page.waitForFunction(() =>
			document
				.getAnimations()
				.every(
					(a) =>
						a.playState !== 'running' ||
						a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
				),
		)
		await test.info().attach(name, {
			body: await page.screenshot(),
			contentType: 'image/png',
		})
	})
}
