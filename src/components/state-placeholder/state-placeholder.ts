import { bindable } from 'aurelia'

export class StatePlaceholder {
	@bindable public icon = ''
	/**
	 * Loading/skeleton variant: renders layout-preserving skeleton bars instead
	 * of the icon + slotted message, so a pending region shows a content-shaped
	 * placeholder rather than bare "loading" text. `rows` controls how many bars.
	 */
	@bindable public loading = false
	@bindable public rows: number | string = 3

	// Pure computed: Aurelia memoizes it against its only dependency (`rows`) and
	// re-evaluates solely when `rows` changes, so there is no per-tick churn — a
	// getter with side effects (caching into a field) is what Aurelia's computed
	// observer forbids (AUR0227). `rows` may arrive as a string attribute, so
	// coerce and guard NaN / non-positive down to a single row.
	public get rowList(): number[] {
		const n = Math.max(1, Math.floor(Number(this.rows)) || 1)
		return Array.from({ length: n }, (_, i) => i)
	}
}
