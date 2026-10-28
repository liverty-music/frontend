import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ja from '../../locales/ja/translation.json'
import type { RangeChangedDetail } from './date-range-sheet'

// ── Mocks ──────────────────────────────────────────────────────────────────

const host = document.createElement('date-range-sheet')

/** Japanese copy for `allNearby.*` keys, with `{{x}}` interpolation. */
function tr(key: string, params: Record<string, unknown> = {}): string {
	const value = key
		.split('.')
		.reduce<unknown>(
			(node, part) => (node as Record<string, unknown>)?.[part],
			ja,
		)
	if (typeof value !== 'string') return key
	return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name]))
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const name = (token as { friendlyName?: string }).friendlyName ?? ''
			if (name === 'INode') return host
			if (name === 'I18N') return { tr }
			return {}
		}),
	}
})

import { DateRangeSheet } from './date-range-sheet'

// Wednesday 2026-08-12, the local date the presets resolve against.
const WEDNESDAY = new Date(2026, 7, 12, 10, 0, 0)

describe('DateRangeSheet', () => {
	let sut: DateRangeSheet
	let emitted: RangeChangedDetail[]
	const listener = (e: Event) =>
		emitted.push((e as CustomEvent<RangeChangedDetail>).detail)

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(WEDNESDAY)
		emitted = []
		host.addEventListener('range-changed', listener)
		sut = new DateRangeSheet()
	})

	afterEach(() => {
		host.removeEventListener('range-changed', listener)
		vi.useRealTimers()
	})

	it('emits the 7日以内 range on bind, so the view loads before the sheet is opened', () => {
		sut.bound()
		expect(emitted).toEqual([
			{
				from: { year: 2026, month: 8, day: 12 },
				to: { year: 2026, month: 8, day: 18 },
				label: '7日以内',
			},
		])
	})

	it('starts from the range the host already has', () => {
		sut.initialRange = {
			from: { year: 2026, month: 8, day: 15 },
			to: { year: 2026, month: 8, day: 16 },
		}
		sut.bound()
		expect(emitted.at(-1)).toEqual({ ...sut.initialRange, label: '今週末' })
	})

	// @spec components/infrastructure/fan/web/route/discovery "Date chip opens the range sheet in one tap"
	// @spec components/infrastructure/fan/web/route/discovery "Available quick presets"
	it('opens with exactly three quick presets and the editable start and end fields', () => {
		sut.bound()
		sut.open()
		expect(sut.isOpen).toBe(true)
		expect(sut.presets).toEqual(['weekend', 'week', 'month'])
		expect(sut.presets.map((p) => tr(`allNearby.datePreset.${p}`))).toEqual([
			'今週末',
			'7日以内',
			'30日以内',
		])
		expect(sut.draftFrom).toBe('2026-08-12')
		expect(sut.draftTo).toBe('2026-08-18')
	})

	// @spec components/infrastructure/fan/web/route/discovery "Quick preset applies and closes in one tap"
	// @spec components/infrastructure/fan/web/route/discovery "Preset shows its name"
	it('applies a quick preset and closes in one tap, labelled by the preset name', () => {
		sut.bound()
		sut.open()
		sut.selectPreset('weekend')
		expect(sut.isOpen).toBe(false)
		expect(emitted.at(-1)).toEqual({
			from: { year: 2026, month: 8, day: 15 },
			to: { year: 2026, month: 8, day: 16 },
			label: '今週末',
		})
		sut.selectPreset('month')
		expect(emitted.at(-1)?.label).toBe('30日以内')
	})

	// @spec components/infrastructure/fan/web/route/discovery "Custom range is edited then applied"
	// @spec components/infrastructure/fan/web/route/discovery "Date chip shows a localized range"
	it('keeps the sheet open while the dates are edited, then applies them with a localized label', () => {
		sut.bound()
		sut.open()
		sut.draftFrom = '2026-08-12'
		sut.draftTo = '2026-08-20'
		sut.onDraftChanged()
		expect(sut.isOpen).toBe(true)
		expect(emitted).toHaveLength(1)

		sut.applyCustom()
		expect(sut.isOpen).toBe(false)
		expect(emitted.at(-1)).toEqual({
			from: { year: 2026, month: 8, day: 12 },
			to: { year: 2026, month: 8, day: 20 },
			label: '8/12〜8/20',
		})
	})

	// @spec components/infrastructure/fan/web/route/discovery "Single-day range"
	it('labels a single-day range with that one date', () => {
		sut.bound()
		sut.open()
		sut.draftFrom = '2026-08-10'
		sut.draftTo = '2026-08-10'
		sut.applyCustom()
		expect(emitted.at(-1)?.label).toBe('8/10')
	})

	// @spec components/infrastructure/fan/web/route/discovery "Custom range validation"
	it('never lets the end come before the start or the range exceed 30 days, and blocks applying it', () => {
		sut.bound()
		sut.open()

		sut.draftFrom = '2026-08-20'
		sut.draftTo = '2026-08-12'
		expect(sut.isDraftValid).toBe(false)
		expect(sut.hint).toBe('終了日は開始日より後にしてください')
		sut.applyCustom()
		expect(sut.isOpen).toBe(true)
		expect(emitted).toHaveLength(1)
		// The end field cannot go before the start.
		expect(sut.toMin).toBe('2026-08-20')
		sut.onDraftChanged()
		expect(sut.draftTo).toBe('2026-08-20')

		sut.draftFrom = '2026-08-01'
		sut.draftTo = '2026-09-15'
		expect(sut.isDraftValid).toBe(false)
		expect(sut.hint).toBe('選べるのは最大30日間までです')
		expect(sut.toMax).toBe('2026-08-30')
		sut.onDraftChanged()
		expect(sut.draftTo).toBe('2026-08-30')
		expect(sut.hint).toBe('30日間')
	})
})
