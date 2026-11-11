import type { BrowserCommand } from 'vitest/node'

/**
 * Browser commands for stories that need a real held pointer: `:active` is set
 * only by a real press, which neither `storybook/test` (synthetic events) nor
 * `vitest/browser`'s `userEvent.click` (press and release) can hold.
 *
 * The provider is Playwright; the story runs inside the test iframe, so the
 * target is found through `iframe` and the mouse moves in page coordinates.
 */
interface PlaywrightContext {
	page: {
		context(): {
			newCDPSession(page: unknown): Promise<{
				send(method: string, params?: object): Promise<unknown>
				detach(): Promise<void>
			}>
		}
		mouse: {
			move(x: number, y: number): Promise<void>
			down(): Promise<void>
			up(): Promise<void>
		}
	}
	iframe: {
		locator(selector: string): {
			first(): {
				boundingBox(): Promise<{
					x: number
					y: number
					width: number
					height: number
				} | null>
			}
		}
	}
}

export const pressAndHold: BrowserCommand<[selector: string]> = async (
	context,
	selector,
) => {
	const { page, iframe } = context as unknown as PlaywrightContext
	const box = await iframe.locator(selector).first().boundingBox()
	if (!box) throw new Error(`pressAndHold: ${selector} is not laid out`)
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
}

export const releasePointer: BrowserCommand<[]> = async (context) => {
	const { page } = context as unknown as PlaywrightContext
	await page.mouse.up()
}

/**
 * Moves the real pointer to the page's top-left corner. The browser keeps the
 * pointer where the previous story left it, so a control that happens to lie
 * under it renders hovered; parking it before each story keeps screenshots
 * deterministic.
 */
export const parkPointer: BrowserCommand<[]> = async (context) => {
	const { page } = context as unknown as PlaywrightContext
	await page.mouse.move(0, 0)
}

/**
 * Drags a finger sideways across `selector` by `dx` px (negative: to the
 * left) from its centre in ten steps, holds still and lifts it, so scroll
 * snapping decides where the content comes to rest. Raw touch events through Chromium's
 * DevTools protocol: scrolling by script is not a swipe (no pointer events, no
 * snap-back), and the protocol's synthesized scroll gesture does not scroll in
 * headless Chromium.
 */
export const swipeSideways: BrowserCommand<
	[selector: string, dx: number]
> = async (context, selector, dx) => {
	const { page, iframe } = context as unknown as PlaywrightContext
	const box = await iframe.locator(selector).first().boundingBox()
	if (!box) throw new Error(`swipeSideways: ${selector} is not laid out`)
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	const steps = 10
	const cdp = await page.context().newCDPSession(page)
	const touch = (type: string, points: Array<{ x: number; y: number }>) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
	try {
		await touch('touchStart', [{ x, y }])
		for (let i = 1; i <= steps; i++) {
			await touch('touchMove', [{ x: x + (dx * i) / steps, y }])
			await new Promise((r) => setTimeout(r, 16))
		}
		// Rest before lifting, so no fling carries the content on: where it
		// comes to rest depends on how far it was dragged, not how fast.
		await new Promise((r) => setTimeout(r, 300))
		await touch('touchEnd', [])
	} finally {
		await cdp.detach()
	}
}

/**
 * Drags a finger vertically across `selector`: from its centre it moves
 * through each offset in `path` (px, positive is down) in ten steps apiece,
 * holds still and lifts, so scroll snapping decides where the content comes
 * to rest. `[160]` is a swipe down; `[120, -120]` drags down and back before
 * lifting. Raw touch events, as in `swipeSideways`.
 */
export const swipeVertically: BrowserCommand<
	[selector: string, path: number[]]
> = async (context, selector, path) => {
	const { page, iframe } = context as unknown as PlaywrightContext
	const box = await iframe.locator(selector).first().boundingBox()
	if (!box) throw new Error(`swipeVertically: ${selector} is not laid out`)
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	const steps = 10
	const cdp = await page.context().newCDPSession(page)
	const touch = (type: string, points: Array<{ x: number; y: number }>) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
	try {
		await touch('touchStart', [{ x, y }])
		let from = 0
		for (const to of path) {
			for (let i = 1; i <= steps; i++) {
				await touch('touchMove', [
					{ x, y: y + from + ((to - from) * i) / steps },
				])
				await new Promise((r) => setTimeout(r, 16))
			}
			from = to
		}
		await new Promise((r) => setTimeout(r, 300))
		await touch('touchEnd', [])
	} finally {
		await cdp.detach()
	}
}

declare module 'vitest/browser' {
	interface BrowserCommands {
		swipeVertically: (selector: string, path: number[]) => Promise<void>
		swipeSideways: (selector: string, dx: number) => Promise<void>
		pressAndHold: (selector: string) => Promise<void>
		releasePointer: () => Promise<void>
		parkPointer: () => Promise<void>
	}
}
