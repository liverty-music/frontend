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

declare module 'vitest/browser' {
	interface BrowserCommands {
		pressAndHold: (selector: string) => Promise<void>
		releasePointer: () => Promise<void>
	}
}
