import { INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { createTestContainer } from '../../helpers/create-container'

const { EventDetailSheet } = await import(
	'../../../src/components/live-highway/event-detail-sheet'
)

function makeEvent(overrides: Partial<LiveEvent> = {}): LiveEvent {
	return {
		id: 'c1',
		artistName: 'Test Artist',
		artistId: 'a1',
		venueName: 'Test Venue',
		locationLabel: 'Tokyo',
		adminArea: 'Tokyo',
		date: new Date(2026, 2, 15), // March 15, 2026
		startTime: '19:00',
		title: 'Test Concert',
		sourceUrl: 'https://example.com',
		hypeLevel: 'watch',
		...overrides,
	}
}

describe('EventDetailSheet', () => {
	let sut: InstanceType<typeof EventDetailSheet>
	let mockElement: HTMLElement

	beforeEach(() => {
		mockElement = document.createElement('div')
		const scrollable = document.createElement('div')
		scrollable.classList.add('overflow-y-auto')
		Object.defineProperty(scrollable, 'scrollTop', { value: 0, writable: true })
		mockElement.appendChild(scrollable)

		const container = createTestContainer(
			Registration.instance(INode, mockElement),
		)
		container.register(EventDetailSheet)
		sut = container.get(EventDetailSheet)

		// Mock sheet element for Popover API
		const mockSheet = document.createElement('div')
		;(mockSheet as any).showPopover = vi.fn()
		;(mockSheet as any).hidePopover = vi.fn()
		const sheetScrollable = document.createElement('div')
		sheetScrollable.classList.add('overflow-y-auto')
		Object.defineProperty(sheetScrollable, 'scrollTop', {
			value: 0,
			writable: true,
		})
		mockSheet.appendChild(sheetScrollable)
		;(sut as any).sheetElement = mockSheet
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('googleMapsUrl', () => {
		it('should construct URL with venue and admin area', () => {
			sut.event = makeEvent({ venueName: 'Budokan', adminArea: 'Tokyo' })

			expect(sut.googleMapsUrl).toBe(
				'https://www.google.com/maps/search/?api=1&query=Budokan%20Tokyo',
			)
		})

		it('should use only venue name when no admin area', () => {
			sut.event = makeEvent({ venueName: 'Budokan', adminArea: undefined })

			expect(sut.googleMapsUrl).toBe(
				'https://www.google.com/maps/search/?api=1&query=Budokan',
			)
		})

		it('should return "#" when no event', () => {
			sut.event = null
			expect(sut.googleMapsUrl).toBe('#')
		})
	})

	describe('calendarUrl', () => {
		it('should construct Google Calendar URL', () => {
			sut.event = makeEvent({
				title: 'Rock Show',
				date: new Date(2026, 2, 15), // March 15
				startTime: '19:00',
				venueName: 'Budokan',
			})

			const url = sut.calendarUrl

			expect(url).toContain('calendar.google.com/calendar/render')
			expect(url).toContain('text=Rock%20Show')
			expect(url).toContain('dates=20260315T190000/')
			expect(url).toContain('location=Budokan')
		})

		it('should return "#" when no event', () => {
			sut.event = null
			expect(sut.calendarUrl).toBe('#')
		})
	})

	describe('backgroundColor', () => {
		it('should return an hsl color string when event exists', () => {
			sut.event = makeEvent()
			expect(sut.backgroundColor).toMatch(/^hsl\(/)
		})

		it('should return default grey when no event', () => {
			sut.event = null
			expect(sut.backgroundColor).toBe('hsl(0, 0%, 20%)')
		})
	})

	describe('open / close', () => {
		it('should open with event and push history state', () => {
			const pushSpy = vi.spyOn(history, 'pushState')
			const event = makeEvent()

			sut.open(event)

			expect(sut.isOpen).toBe(true)
			expect(sut.event).toBe(event)
			expect(pushSpy).toHaveBeenCalledWith(
				{ concertId: 'c1' },
				'',
				'/concerts/c1',
			)
		})

		it('should close and replace history state', () => {
			const replaceSpy = vi.spyOn(history, 'replaceState')
			sut.isOpen = true

			sut.close()

			expect(sut.isOpen).toBe(false)
			expect(sut.dragOffset).toBe(0)
			expect(replaceSpy).toHaveBeenCalledWith(null, '', '/dashboard')
		})
	})

	describe('touch drag dismiss', () => {
		it('should close when drag exceeds 100px threshold', () => {
			sut.open(makeEvent())

			sut.onTouchStart({ touches: [{ clientY: 100 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 250 }] } as any) // delta = 150
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(false)
		})

		it('should snap back when drag is below threshold', () => {
			sut.open(makeEvent())

			sut.onTouchStart({ touches: [{ clientY: 100 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 150 }] } as any) // delta = 50
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(true)
			expect(sut.dragOffset).toBe(0)
		})

		it('should not start drag when not open', () => {
			sut.isOpen = false

			sut.onTouchStart({ touches: [{ clientY: 100 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 300 }] } as any)
			sut.onTouchEnd()

			expect(sut.dragOffset).toBe(0)
		})

		it('should not allow negative drag offset', () => {
			sut.open(makeEvent())

			sut.onTouchStart({ touches: [{ clientY: 200 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 100 }] } as any) // delta = -100

			expect(sut.dragOffset).toBe(0)
		})
	})
})
