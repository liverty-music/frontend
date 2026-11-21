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
	private readonly listeners = new Set<() => void>()

	/** Number of open sheets; observable, so bindings re-evaluate. */
	public openCount = 0

	public get anyOpen(): boolean {
		return this.openCount > 0
	}

	public opened(sheet: object): void {
		this.sheets.add(sheet)
		this.update()
	}

	/** Idempotent: a sheet may report closing more than once. */
	public closed(sheet: object): void {
		this.sheets.delete(sheet)
		this.update()
	}

	/**
	 * Call `listener` whenever the number of open sheets changes (the guide
	 * moments wait while any sheet is open). Returns the unsubscribe function.
	 */
	public onChange(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private update(): void {
		if (this.openCount === this.sheets.size) return
		this.openCount = this.sheets.size
		for (const listener of this.listeners) listener()
	}
}
