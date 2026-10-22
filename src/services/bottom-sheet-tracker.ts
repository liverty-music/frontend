import { DI } from 'aurelia'

export const IBottomSheetTracker = DI.createInterface<IBottomSheetTracker>(
	'IBottomSheetTracker',
	(x) => x.singleton(BottomSheetTracker),
)

export interface IBottomSheetTracker extends BottomSheetTracker {}

/**
 * Which bottom sheets are open, app-wide. Every `<bottom-sheet>` reports its
 * own open and close here, so shell chrome that would cover a sheet (the FAB,
 * a top-layer popover like the sheet itself) can step aside while any sheet
 * is open, whichever screen or component opened it.
 */
export class BottomSheetTracker {
	private readonly sheets = new Set<object>()

	/** Number of open sheets; observable, so bindings re-evaluate. */
	public openCount = 0

	public get anyOpen(): boolean {
		return this.openCount > 0
	}

	public opened(sheet: object): void {
		this.sheets.add(sheet)
		this.openCount = this.sheets.size
	}

	/** Idempotent: a sheet may report closing more than once. */
	public closed(sheet: object): void {
		this.sheets.delete(sheet)
		this.openCount = this.sheets.size
	}
}
