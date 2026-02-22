import { INode, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AreaSelectorSheet } from '../../src/components/area-selector-sheet/area-selector-sheet'
import { createTestContainer } from '../helpers/create-container'

function makeTouchEvent(clientY: number): TouchEvent {
	return {
		touches: [{ clientY }],
		preventDefault: vi.fn(),
	} as unknown as TouchEvent
}

describe('AreaSelectorSheet', () => {
	let sut: AreaSelectorSheet
	let mockElement: HTMLElement

	beforeEach(() => {
		localStorage.clear()
		mockElement = document.createElement('div')
		const container = createTestContainer(
			Registration.instance(INode, mockElement),
		)
		container.register(AreaSelectorSheet)
		sut = container.get(AreaSelectorSheet)
	})

	describe('getStoredArea', () => {
		it('should return null when no area is stored', () => {
			expect(AreaSelectorSheet.getStoredArea()).toBeNull()
		})

		it('should return stored area', () => {
			localStorage.setItem('liverty-music:user-region', '東京')
			expect(AreaSelectorSheet.getStoredArea()).toBe('東京')
		})
	})

	describe('open', () => {
		it('should set isOpen to true and reset state', () => {
			sut.selectedRegion = '関東'
			sut.prefectures = ['東京']

			sut.open()

			expect(sut.isOpen).toBe(true)
			expect(sut.selectedRegion).toBe('')
			expect(sut.prefectures).toEqual([])
		})
	})

	describe('close', () => {
		it('should set isOpen to false', () => {
			sut.isOpen = true
			sut.close()
			expect(sut.isOpen).toBe(false)
		})
	})

	describe('selectRegion', () => {
		it('should set selected region and load prefectures', () => {
			sut.selectRegion('関東')

			expect(sut.selectedRegion).toBe('関東')
			expect(sut.prefectures).toContain('東京')
			expect(sut.prefectures).toContain('神奈川')
		})

		it('should return empty prefectures for unknown region', () => {
			sut.selectRegion('unknown')
			expect(sut.prefectures).toEqual([])
		})
	})

	describe('selectPrefecture', () => {
		it('should store selection and close sheet', () => {
			sut.isOpen = true
			const callback = vi.fn()
			sut.onAreaSelected = callback

			sut.selectPrefecture('東京')

			expect(localStorage.getItem('liverty-music:user-region')).toBe('東京')
			expect(sut.isOpen).toBe(false)
			expect(callback).toHaveBeenCalledWith('東京')
		})

		it('should not throw when no callback is set', () => {
			sut.isOpen = true
			expect(() => sut.selectPrefecture('大阪')).not.toThrow()
		})
	})

	describe('goBackToRegions', () => {
		it('should clear selected region and prefectures', () => {
			sut.selectedRegion = '関東'
			sut.prefectures = ['東京']

			sut.goBackToRegions()

			expect(sut.selectedRegion).toBe('')
			expect(sut.prefectures).toEqual([])
		})
	})

	describe('sheetTransform', () => {
		it('should return translateY(100%) when closed', () => {
			sut.isOpen = false
			expect(sut.sheetTransform).toBe('transform: translateY(100%)')
		})

		it('should return empty string when open with no drag', () => {
			sut.isOpen = true
			expect(sut.sheetTransform).toBe('')
		})

		it('should return drag offset when dragging', () => {
			sut.open()
			sut.onTouchStart(makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(150))

			expect(sut.sheetTransform).toBe('transform: translateY(50px)')
		})
	})

	describe('touch interactions', () => {
		it('should ignore touch start when closed', () => {
			sut.isOpen = false
			sut.onTouchStart(makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(200))
			expect(sut.sheetTransform).toBe('transform: translateY(100%)')
		})

		it('should call preventDefault only on downward drag', () => {
			sut.open()
			sut.onTouchStart(makeTouchEvent(100))
			const moveEvent = makeTouchEvent(150)
			sut.onTouchMove(moveEvent)

			expect(moveEvent.preventDefault).toHaveBeenCalled()
		})

		it('should dismiss when drag exceeds threshold', () => {
			sut.open()
			sut.onTouchStart(makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(250))
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(false)
		})

		it('should snap back when drag is below threshold', () => {
			sut.open()
			sut.onTouchStart(makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(150))
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(true)
			expect(sut.sheetTransform).toBe('')
		})

		it('should cancel drag and allow scroll on upward gesture', () => {
			sut.open()
			sut.onTouchStart(makeTouchEvent(200))
			const moveEvent = makeTouchEvent(100)
			sut.onTouchMove(moveEvent)

			expect(sut.isDragging).toBe(false)
			expect(sut.sheetTransform).toBe('')
			expect(moveEvent.preventDefault).not.toHaveBeenCalled()
		})

		it('should stop dragging and reset dragOffset if scrollable has scroll position', () => {
			const scrollable = document.createElement('div')
			scrollable.classList.add('overflow-y-auto')
			Object.defineProperty(scrollable, 'scrollTop', { value: 10 })
			mockElement.appendChild(scrollable)

			// open() caches the scrollable element
			sut.open()
			sut.onTouchStart(makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(150))
			// dragOffset should be reset even though we moved
			sut.onTouchMove(makeTouchEvent(250))
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(true)
			expect(sut.sheetTransform).toBe('')
		})
	})
})
