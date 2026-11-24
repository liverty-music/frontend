import { openShell, seedSignedInFan } from '../support/fan-shell'
import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })
test.use({ viewport: { width: 390, height: 844 } })

const SETTINGS = 'components/infrastructure/fan/web/route/settings'

test(`@spec ${SETTINGS} "Switch is pressed"`, async ({ page }) => {
	await seedSignedInFan(page)
	await openShell(page, '/settings')
	const toggle = page.getByRole('switch', { name: /Left-handed|左利き/ })
	const track = toggle.locator('.settings-toggle-track')
	const thumb = toggle.locator('.settings-toggle-thumb')
	const size = async (locator: typeof thumb) => {
		const b = await locator.boundingBox()
		if (!b) throw new Error('no box')
		return { width: Math.round(b.width), height: Math.round(b.height) }
	}

	await expect.poll(() => size(thumb)).toEqual({ width: 16, height: 16 })
	const before = await size(track)
	expect(before).toEqual({ width: 52, height: 32 })

	await toggle.hover()
	await page.mouse.down()
	await expect.poll(() => size(thumb)).toEqual({ width: 28, height: 28 })
	// The handle stays inside the track, which keeps its size.
	const t = await track.boundingBox()
	const h = await thumb.boundingBox()
	if (!t || !h) throw new Error('no box')
	expect(h.x).toBeGreaterThanOrEqual(t.x)
	expect(h.x + h.width).toBeLessThanOrEqual(t.x + t.width)
	expect(h.y).toBeGreaterThanOrEqual(t.y)
	expect(h.y + h.height).toBeLessThanOrEqual(t.y + t.height)
	expect(await size(track)).toEqual(before)
	await page.mouse.up()
})
