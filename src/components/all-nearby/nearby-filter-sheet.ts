import { bindable, INode, resolve } from 'aurelia'

/** The selector a row of the filter sheet opens. */
export type NearbyFilterRow = 'area' | 'period'

/**
 * The All Nearby filter sheet, opened from the action launcher's filter item:
 * two rows, the area and the period, each showing its current value. A tap on
 * a row closes this sheet and, once it has finished closing, dispatches
 * `filter-row-chosen` with the row, so the host opens that row's selector and
 * two sheets are never open at once.
 */
export class NearbyFilterSheet {
	/** The area's display name; empty while there is none (a guest without a home). */
	@bindable public areaName = ''
	/** The period's label: a preset name or a localized range. */
	@bindable public periodLabel = ''

	public isOpen = false

	private chosen: NearbyFilterRow | null = null
	private readonly element = resolve(INode) as HTMLElement

	public open(): void {
		this.chosen = null
		this.isOpen = true
	}

	public choose(row: NearbyFilterRow): void {
		this.chosen = row
		this.isOpen = false
	}

	/** The fan dismissed the sheet (swipe, tap outside, Escape). */
	public onSheetClosed(): void {
		this.isOpen = false
	}

	/** The sheet has finished closing: now the chosen selector may open. */
	public onSheetHidden(): void {
		const row = this.chosen
		this.chosen = null
		if (!row) return
		this.element.dispatchEvent(
			new CustomEvent<NearbyFilterRow>('filter-row-chosen', {
				detail: row,
				bubbles: true,
			}),
		)
	}
}
