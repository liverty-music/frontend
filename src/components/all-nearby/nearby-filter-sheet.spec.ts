import { describe, expect, it, vi } from 'vitest'

const host = document.createElement('nearby-filter-sheet')

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return { ...actual, resolve: vi.fn(() => host) }
})

const { NearbyFilterSheet } = await import('./nearby-filter-sheet')

describe('NearbyFilterSheet', () => {
	function chosenRows(
		run: (sut: InstanceType<typeof NearbyFilterSheet>) => void,
	) {
		const rows: string[] = []
		const listener = (e: Event) => rows.push((e as CustomEvent<string>).detail)
		host.addEventListener('filter-row-chosen', listener)
		run(new NearbyFilterSheet())
		host.removeEventListener('filter-row-chosen', listener)
		return rows
	}

	// @spec components/infrastructure/fan/web/route/discovery "A row opens its selector"
	it('closes on a row and reports it only once the sheet has finished closing', () => {
		const rows = chosenRows((sut) => {
			sut.open()
			expect(sut.isOpen).toBe(true)
			const reported: Event[] = []
			host.addEventListener('filter-row-chosen', (e) => reported.push(e), {
				once: true,
			})
			sut.choose('area')
			expect(sut.isOpen).toBe(false)
			// Still closing: no other sheet may open yet.
			expect(reported).toEqual([])
			sut.onSheetHidden()
		})
		expect(rows).toEqual(['area'])
	})

	it('reports the period row the same way', () => {
		const rows = chosenRows((sut) => {
			sut.open()
			sut.choose('period')
			sut.onSheetHidden()
		})
		expect(rows).toEqual(['period'])
	})

	it('reports nothing when the fan dismisses the sheet', () => {
		const rows = chosenRows((sut) => {
			sut.open()
			sut.onSheetClosed()
			sut.onSheetHidden()
		})
		expect(rows).toEqual([])
	})
})
