import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeFabMenu = { actions: [] as unknown[], handed: 'right' }
const fakeSignaler = { dispatchSignal: vi.fn() }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const name = (token as { friendlyName?: string })?.friendlyName
			return name === 'ISignaler' ? fakeSignaler : fakeFabMenu
		}),
	}
})

import type { FabAction } from '../../services/fab-menu-service'
import { FabMenu } from './fab-menu'

function makeAction(overrides: Partial<FabAction> = {}): FabAction {
	return {
		id: 'a',
		labelKey: 'label.a',
		icon: 'plus',
		kind: 'command',
		invoke: vi.fn(),
		...overrides,
	}
}

describe('FabMenu', () => {
	let sut: FabMenu
	let firstItem: { focus: ReturnType<typeof vi.fn> }
	let fabButton: { focus: ReturnType<typeof vi.fn> }
	let panel: {
		hidePopover: ReturnType<typeof vi.fn>
		querySelector: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new FabMenu()
		firstItem = { focus: vi.fn() }
		fabButton = { focus: vi.fn() }
		panel = {
			hidePopover: vi.fn(),
			querySelector: vi.fn(() => firstItem),
		}
		Object.defineProperty(sut, 'fabButton', {
			value: fabButton,
			writable: true,
		})
		Object.defineProperty(sut, 'panel', { value: panel, writable: true })
	})

	describe('onPanelToggle (disclosure state + focus)', () => {
		it('reflects the open state and moves focus into the panel', () => {
			sut.onPanelToggle({ newState: 'open' } as ToggleEvent)
			expect(sut.isOpen).toBe(true)
			expect(panel.querySelector).toHaveBeenCalledWith('.fab-item')
			expect(firstItem.focus).toHaveBeenCalledOnce()
		})

		it('returns focus to the FAB on close (Esc / light-dismiss)', () => {
			sut.onPanelToggle({ newState: 'open' } as ToggleEvent)
			sut.onPanelToggle({ newState: 'closed' } as ToggleEvent)
			expect(sut.isOpen).toBe(false)
			expect(fabButton.focus).toHaveBeenCalledOnce()
		})
	})

	describe('onAction', () => {
		it('closes the panel for a command (only one overlay active)', () => {
			const invoke = vi.fn()
			sut.onAction(makeAction({ kind: 'command', invoke }))
			expect(panel.hidePopover).toHaveBeenCalledOnce()
			expect(invoke).toHaveBeenCalledOnce()
		})

		it('keeps the panel open for a toggle', () => {
			const invoke = vi.fn()
			sut.onAction(makeAction({ kind: 'toggle', invoke }))
			expect(panel.hidePopover).not.toHaveBeenCalled()
			expect(invoke).toHaveBeenCalledOnce()
		})

		it('does not return focus to the FAB when a command opens a surface', () => {
			// hidePopover would fire a close toggle; the suppress flag keeps focus in
			// the newly opened surface.
			sut.onAction(makeAction({ kind: 'command' }))
			sut.onPanelToggle({ newState: 'closed' } as ToggleEvent)
			expect(fabButton.focus).not.toHaveBeenCalled()
		})
	})

	describe('isPressed / isActive', () => {
		it('exposes aria-pressed only for toggle items', () => {
			expect(
				sut.isPressed(makeAction({ kind: 'toggle', isOn: () => true })),
			).toBe(true)
			expect(
				sut.isPressed(makeAction({ kind: 'toggle', isOn: () => false })),
			).toBe(false)
			// A command is never "pressed", even if it reports an active state.
			expect(
				sut.isPressed(makeAction({ kind: 'command', isOn: () => true })),
			).toBe(false)
		})

		it('exposes data-active from isOn for either kind', () => {
			expect(
				sut.isActive(makeAction({ kind: 'command', isOn: () => true })),
			).toBe(true)
			expect(sut.isActive(makeAction({ kind: 'command' }))).toBe(false)
		})
	})
})
