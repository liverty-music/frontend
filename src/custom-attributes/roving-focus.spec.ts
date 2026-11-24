import { createFixture } from '@aurelia/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { RovingFocusCustomAttribute } from './roving-focus'

describe('roving-focus', () => {
	let fixture: Awaited<ReturnType<typeof createFixture>['started']>

	const start = async (template: string) => {
		fixture = await createFixture(template, class {}, [
			RovingFocusCustomAttribute,
		]).started
		return [...fixture.appHost.querySelectorAll<HTMLElement>('a')]
	}
	const key = (el: HTMLElement, k: string) => {
		const event = new KeyboardEvent('keydown', {
			key: k,
			bubbles: true,
			cancelable: true,
		})
		el.dispatchEvent(event)
		return event
	}
	const stops = (items: HTMLElement[]) =>
		items.map((i) => i.getAttribute('tabindex'))

	afterEach(async () => {
		await fixture.stop(true)
	})

	it('makes the current item the one Tab stop, else the first', async () => {
		const a = await start(
			'<nav roving-focus="a"><a href="#1">1</a><a href="#2" aria-current="page">2</a><a href="#3">3</a></nav>',
		)
		expect(stops(a)).toEqual(['-1', '0', '-1'])

		await fixture.stop(true)
		const b = await start(
			'<nav roving-focus="a"><a href="#1">1</a><a href="#2">2</a></nav>',
		)
		expect(stops(b)).toEqual(['0', '-1'])
	})

	it('moves focus with the arrows, wrapping, and with Home and End', async () => {
		const items = await start(
			'<nav roving-focus="a"><a href="#1">1</a><a href="#2">2</a><a href="#3">3</a></nav>',
		)
		items[0].focus()

		expect(key(items[0], 'ArrowRight').defaultPrevented).toBe(true)
		expect(document.activeElement).toBe(items[1])
		expect(stops(items)).toEqual(['-1', '0', '-1'])

		key(items[1], 'ArrowDown')
		expect(document.activeElement).toBe(items[2])
		key(items[2], 'ArrowRight')
		expect(document.activeElement).toBe(items[0])
		key(items[0], 'ArrowLeft')
		expect(document.activeElement).toBe(items[2])
		key(items[2], 'Home')
		expect(document.activeElement).toBe(items[0])
		key(items[0], 'End')
		expect(document.activeElement).toBe(items[2])
	})

	it('takes the stop off an item that becomes unavailable', async () => {
		const items = await start(
			'<nav roving-focus="a"><a href="#1">1</a><a href="#2">2</a></nav>',
		)
		expect(stops(items)).toEqual(['0', '-1'])
		items[0].setAttribute('aria-disabled', 'true')
		await new Promise((resolve) => setTimeout(resolve, 0))
		// One Tab stop remains, and it is not the unavailable item.
		expect(stops(items)).toEqual(['-1', '0'])
	})

	it('leaves other keys alone and skips unavailable items', async () => {
		const items = await start(
			'<nav roving-focus="a"><a href="#1">1</a><a href="#2" aria-disabled="true">2</a><a href="#3">3</a></nav>',
		)
		items[0].focus()
		expect(key(items[0], 'a').defaultPrevented).toBe(false)
		key(items[0], 'ArrowRight')
		expect(document.activeElement).toBe(items[2])
	})
})
