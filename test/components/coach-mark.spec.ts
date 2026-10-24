import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '../helpers/mock-logger'

const { CoachMark } = await import('../../src/components/coach-mark/coach-mark')

function createMockElement(
	opts: { top?: number; height?: number } = {},
): HTMLElement {
	const el = document.createElement('div')
	el.getBoundingClientRect = () =>
		({
			top: opts.top ?? 100,
			bottom: (opts.top ?? 100) + (opts.height ?? 50),
			left: 50,
			right: 200,
			width: 150,
			height: opts.height ?? 50,
			x: 50,
			y: opts.top ?? 100,
			toJSON: () => ({}),
		}) as DOMRect
	return el
}

describe('CoachMark', () => {
	let sut: InstanceType<typeof CoachMark>
	let targetEl: HTMLElement

	beforeEach(() => {
		vi.useFakeTimers()

		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		sut = container.invoke(CoachMark)

		targetEl = createMockElement()
		targetEl.setAttribute('data-test-target', '')
		document.body.appendChild(targetEl)

		sut.targetSelector = '[data-test-target]'
	})

	afterEach(() => {
		vi.useRealTimers()
		if (targetEl.parentNode) document.body.removeChild(targetEl)
		vi.restoreAllMocks()
	})

	describe('highlight', () => {
		it('sets anchor-name on target and becomes visible when activated', () => {
			sut.active = true
			sut.activeChanged()

			expect(targetEl.style.getPropertyValue('anchor-name')).toBe(
				'--coach-target',
			)
			expect(sut.visible).toBe(true)
		})
	})

	describe('deactivate', () => {
		it('clears anchor-name and visibility', () => {
			sut.active = true
			sut.activeChanged()

			sut.deactivate()

			expect(targetEl.style.getPropertyValue('anchor-name')).toBe('')
			expect(sut.visible).toBe(false)
		})
	})

	describe('light-dismiss (document pointerdown outside the target)', () => {
		it('dismisses on an outside pointerdown without triggering the target click', () => {
			const onDismiss = vi.fn()
			sut.onDismiss = onDismiss
			sut.overlayEl = document.createElement('div') // contains nothing → outside
			sut.active = true
			sut.activeChanged() // highlight() arms the document pointerdown listener
			expect(sut.visible).toBe(true)

			const clickSpy = vi.spyOn(targetEl, 'click')
			document.dispatchEvent(new Event('pointerdown', { bubbles: true }))

			expect(onDismiss).toHaveBeenCalledTimes(1)
			expect(sut.visible).toBe(false)
			// Dismissing must not trigger the target's navigation.
			expect(clickSpy).not.toHaveBeenCalled()
		})

		it('does not dismiss on a pointerdown inside the coach mark', () => {
			const onDismiss = vi.fn()
			sut.onDismiss = onDismiss
			const overlay = document.createElement('div')
			const inside = document.createElement('div')
			overlay.appendChild(inside)
			document.body.appendChild(overlay)
			sut.overlayEl = overlay
			sut.active = true
			sut.activeChanged()

			inside.dispatchEvent(new Event('pointerdown', { bubbles: true }))

			expect(onDismiss).not.toHaveBeenCalled()
			expect(sut.visible).toBe(true)
			overlay.remove()
			sut.deactivate()
		})

		it('does not throw when onDismiss is undefined', () => {
			sut.onDismiss = undefined
			sut.overlayEl = document.createElement('div')
			sut.active = true
			sut.activeChanged()
			expect(() =>
				document.dispatchEvent(new Event('pointerdown', { bubbles: true })),
			).not.toThrow()
		})
	})

	describe('target click', () => {
		it('delegates to the target native click and invokes onTap', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			sut.active = true
			sut.activeChanged()

			const clickSpy = vi.spyOn(targetEl, 'click')
			const event = new Event('click', { bubbles: true })
			vi.spyOn(event, 'preventDefault')
			vi.spyOn(event, 'stopPropagation')

			sut.onTargetClick(event)

			expect(clickSpy).toHaveBeenCalledTimes(1)
			expect(onTap).toHaveBeenCalledTimes(1)
			expect(event.preventDefault).toHaveBeenCalled()
			expect(event.stopPropagation).toHaveBeenCalled()
		})

		it('does not throw when onTap is undefined', () => {
			sut.onTap = undefined
			const event = new Event('click')
			expect(() => sut.onTargetClick(event)).not.toThrow()
		})
	})

	describe('keyboard handler', () => {
		it('invokes onTap on Enter', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			const event = new KeyboardEvent('keydown', { key: 'Enter' })
			vi.spyOn(event, 'preventDefault')

			sut.onKeydown(event)

			expect(onTap).toHaveBeenCalledTimes(1)
			expect(event.preventDefault).toHaveBeenCalled()
		})

		it('invokes onTap on Space', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			sut.onKeydown(new KeyboardEvent('keydown', { key: ' ' }))
			expect(onTap).toHaveBeenCalledTimes(1)
		})

		it('ignores other keys', () => {
			const onTap = vi.fn()
			sut.onTap = onTap
			sut.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))
			expect(onTap).not.toHaveBeenCalled()
		})
	})

	describe('retry behavior', () => {
		// @spec components/infrastructure/fan/web/global/coach-mark "Target never becomes visible"
		it('shows nothing and stops looking when no visible target appears within 5 seconds', async () => {
			sut.targetSelector = '[data-nonexistent]'
			sut.active = true
			sut.activeChanged()

			await vi.advanceTimersByTimeAsync(4999)
			expect(sut.visible).toBe(false)
			await vi.advanceTimersByTimeAsync(1001)

			expect(sut.visible).toBe(false)
			expect(vi.getTimerCount()).toBe(0)
		})

		// @spec components/infrastructure/fan/web/global/coach-mark "Zero-dimension target is skipped"
		it('skips a zero-size target and shows once it becomes visible within 5 seconds', async () => {
			let size = 0
			targetEl.getBoundingClientRect = () =>
				({
					top: 100,
					bottom: 100 + size,
					left: 50,
					right: 50 + size,
					width: size,
					height: size,
					x: 50,
					y: 100,
					toJSON: () => ({}),
				}) as DOMRect
			sut.active = true
			sut.activeChanged()
			expect(sut.visible).toBe(false)
			expect(targetEl.style.getPropertyValue('anchor-name')).toBe('')

			await vi.advanceTimersByTimeAsync(1500)
			expect(sut.visible).toBe(false)

			// The target lays out 1.5 s in; the next look (3.1 s) finds it.
			size = 40
			await vi.advanceTimersByTimeAsync(1600)
			expect(sut.visible).toBe(true)
			expect(targetEl.style.getPropertyValue('anchor-name')).toBe(
				'--coach-target',
			)
		})

		// @spec components/infrastructure/fan/web/global/coach-mark "Hidden element in closed popover is skipped"
		it('does not highlight a target inside a closed sheet and keeps looking for 5 seconds', async () => {
			const sheet = document.createElement('div')
			sheet.setAttribute('popover', 'auto') // closed: its content has no box
			const hidden = document.createElement('div')
			hidden.setAttribute('data-hidden-target', '')
			sheet.appendChild(hidden)
			document.body.appendChild(sheet)
			try {
				// jsdom gives every element a zero rect, as a closed popover's content has.
				sut.targetSelector = '[data-hidden-target]'
				sut.active = true
				sut.activeChanged()

				await vi.advanceTimersByTimeAsync(4900)
				expect(sut.visible).toBe(false)
				expect(hidden.style.getPropertyValue('anchor-name')).toBe('')
				// Still looking just before the window ends…
				expect(vi.getTimerCount()).toBe(1)

				await vi.advanceTimersByTimeAsync(100)
				// …and done once 5 seconds have passed, never having shown it.
				expect(sut.visible).toBe(false)
				expect(vi.getTimerCount()).toBe(0)
			} finally {
				sheet.remove()
			}
		})

		it('does nothing for an empty selector (empty-selector guard)', () => {
			sut.targetSelector = ''
			sut.active = true
			sut.activeChanged()

			expect(sut.visible).toBe(false)
		})
	})
})

/**
 * The coach mark rendered by a screen, in the DOM: what remains on screen after
 * each way it closes, and where it may be rendered at all.
 */
describe('CoachMark rendered by a screen', () => {
	const TARGET = '[data-cm-target]'

	class Screen {
		public onScreen = true
		public active = true
		public targetTaps = 0
		public dismissals = 0
		public onTargetTap: () => void = () => {
			this.targetTaps++
		}
		public dismissed(): void {
			this.dismissals++
			this.active = false
		}
		public tapped(): void {
			this.active = false
		}
	}

	const template = `
		<button data-cm-target click.trigger="onTargetTap()">Target</button>
		<button data-cm-page>Page</button>
		<coach-mark
			if.bind="onScreen"
			target-selector="${TARGET}"
			message="Tip"
			active.bind="active"
			on-tap.bind="() => tapped()"
			on-dismiss.bind="() => dismissed()"
		></coach-mark>`

	let fixture: Awaited<ReturnType<typeof render>> | null = null

	async function render() {
		const f = await createFixture
			.html(template)
			.component(Screen)
			.deps(CoachMark)
			.build().started
		await tasksSettled()
		return f
	}

	const q = (sel: string) => document.querySelector<HTMLElement>(sel)
	const target = () => q(TARGET) as HTMLElement
	/** Every part of the coach mark that paints: dim layer, cutout, message. */
	const coachParts = () =>
		document.querySelectorAll(
			'.coach-mark-overlay, .visual-spotlight, .target-interceptor, [role="tooltip"]',
		).length

	async function shown() {
		fixture = await render()
		await vi.waitFor(() => expect(q('.coach-mark-overlay')).not.toBeNull())
		expect(coachParts()).toBe(4)
		return fixture
	}

	beforeEach(() => {
		// jsdom lays nothing out; give the target a box so it counts as visible.
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
			function (this: HTMLElement) {
				const size = this.hasAttribute('data-cm-target') ? 40 : 0
				return {
					top: 0,
					left: 0,
					bottom: size,
					right: size,
					width: size,
					height: size,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				} as DOMRect
			},
		)
	})

	afterEach(async () => {
		await fixture?.stop(true)
		fixture = null
		vi.restoreAllMocks()
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Coach mark closes on any tap or on leaving the screen"
	describe('closes on any tap or on leaving the screen', () => {
		it('a tap on the target performs its action and removes the coach mark', async () => {
			const f = await shown()
			q('.target-interceptor')?.click()
			await tasksSettled()

			expect(f.component.targetTaps).toBe(1)
			expect(coachParts()).toBe(0)
			expect(target().style.getPropertyValue('anchor-name')).toBe('')
		})

		it('a tap outside the target removes the coach mark', async () => {
			const f = await shown()
			q('[data-cm-page]')?.dispatchEvent(
				new Event('pointerdown', { bubbles: true }),
			)
			await tasksSettled()

			expect(f.component.dismissals).toBe(1)
			expect(coachParts()).toBe(0)
			expect(target().style.getPropertyValue('anchor-name')).toBe('')
		})

		it('leaving the screen removes the coach mark', async () => {
			const f = await shown()
			f.component.onScreen = false
			await tasksSettled()

			expect(coachParts()).toBe(0)
			expect(target().style.getPropertyValue('anchor-name')).toBe('')
		})
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Route detaching cleans up spotlight"
	it('leaves no spotlight, message, dim layer or listener behind after the screen goes away', async () => {
		const f = await shown()
		f.component.onScreen = false
		await tasksSettled()

		expect(coachParts()).toBe(0)
		expect(target().style.getPropertyValue('anchor-name')).toBe('')
		// The light-dismiss listener went with it: a later tap reaches nothing.
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
		expect(f.component.dismissals).toBe(0)
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Navigation during active spotlight does not throw"
	describe('navigating away while it is shown does not throw', () => {
		it('when the screen goes away (a link or browser back)', async () => {
			const f = await shown()
			f.component.onScreen = false
			await expect(tasksSettled()).resolves.not.toThrow()
			expect(() =>
				document.body.dispatchEvent(
					new Event('pointerdown', { bubbles: true }),
				),
			).not.toThrow()
		})

		it('when the highlighted target itself navigates away', async () => {
			const f = await shown()
			// The target's own action tears the screen down mid-tap.
			f.component.onTargetTap = () => {
				f.component.onScreen = false
			}
			expect(() => q('.target-interceptor')?.click()).not.toThrow()
			await expect(tasksSettled()).resolves.not.toThrow()
			expect(coachParts()).toBe(0)
		})

		it('while it is still looking for its target', async () => {
			vi.useFakeTimers()
			try {
				// The target never lays out, so the coach mark keeps retrying.
				vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
					top: 0,
					left: 0,
					bottom: 0,
					right: 0,
					width: 0,
					height: 0,
					x: 0,
					y: 0,
					toJSON: () => ({}),
				} as DOMRect)
				const f = await render()
				fixture = f
				expect(vi.getTimerCount()).toBeGreaterThan(0)
				f.component.onScreen = false
				await tasksSettled()
				expect(vi.getTimerCount()).toBe(0)
				await expect(vi.advanceTimersByTimeAsync(6000)).resolves.not.toThrow()
			} finally {
				vi.useRealTimers()
			}
		})
	})
})

describe('Where a coach mark is rendered', () => {
	const templates = import.meta.glob('../../src/**/*.html', {
		query: '?raw',
		import: 'default',
		eager: true,
	}) as Record<string, string>
	/** `<coach-mark>` elements a template renders (comments are not elements). */
	const coachMarksIn = (html: string): number => {
		const doc = new DOMParser().parseFromString(
			`<template>${html}</template>`,
			'text/html',
		)
		const count = (root: ParentNode): number =>
			root.querySelectorAll('coach-mark').length +
			[...root.querySelectorAll('template')].reduce(
				(n, t) => n + count(t.content),
				0,
			)
		return count(doc)
	}
	const WELCOME = '../../src/routes/welcome/welcome-route.html'

	// @spec components/infrastructure/fan/web/global/coach-mark "Only the Welcome demo shows a coach mark"
	it('only the Welcome template renders one, and only one', () => {
		for (const screen of [
			'../../src/app-shell.html',
			'../../src/routes/discovery/discovery-route.html',
			'../../src/routes/dashboard/dashboard-route.html',
			'../../src/routes/my-artists/my-artists-route.html',
		]) {
			expect(templates[screen], screen).toBeDefined()
			expect(coachMarksIn(templates[screen]), screen).toBe(0)
		}
		const rendering = Object.entries(templates)
			.filter(([, html]) => coachMarksIn(html) > 0)
			.map(([file, html]) => [file, coachMarksIn(html)])
		expect(rendering).toEqual([[WELCOME, 1]])
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Target selector is scoped to component context"
	it('Welcome points it at the first card of its own demo timetable, never at another surface', () => {
		const selector = new DOMParser()
			.parseFromString(templates[WELCOME], 'text/html')
			.querySelector('coach-mark')
			?.getAttribute('target-selector')
		expect(selector).toBeDefined()

		// Another surface (a help sheet) earlier in the document also has cards.
		document.body.innerHTML = `
			<section class="page-help-sheet"><div data-live-card id="help-card"></div></section>
			<div class="welcome-demo-timetable">
				<div data-live-card id="first-card"></div>
				<div data-live-card id="second-card"></div>
			</div>`
		try {
			const container = DI.createContainer()
			container.register(Registration.instance(ILogger, createMockLogger()))
			const sut = container.invoke(CoachMark)
			vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
				top: 0,
				left: 0,
				bottom: 40,
				right: 40,
				width: 40,
				height: 40,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			} as DOMRect)
			sut.targetSelector = selector as string
			sut.active = true
			sut.activeChanged()

			const anchored = [...document.querySelectorAll<HTMLElement>('[id]')]
				.filter((el) => el.style.getPropertyValue('anchor-name'))
				.map((el) => el.id)
			expect(anchored).toEqual(['first-card'])
			sut.deactivate()
		} finally {
			document.body.innerHTML = ''
			vi.restoreAllMocks()
		}
	})
})
