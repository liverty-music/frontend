import { bindable } from 'aurelia'
import type { CatalogText } from '../../i18n/catalog-text'
import type { StatusTone } from '../status-badge/status-badge'

export type DataCellKind =
	| 'text'
	| 'count'
	| 'yen'
	| 'datetime'
	| 'date'
	| 'status'

/** Text of a cell: shown as is (a title, a venue) or from the catalog. */
export type CellText = string | CatalogText

export interface DataColumn {
	key: string
	/** Catalog key of the column title. */
	labelKey: string
	kind?: DataCellKind
	/** The row's title: the list item's headline and the table's row header. */
	primary?: boolean
	/** In the list, shown at the item's trailing edge (the row's status). */
	trailing?: boolean
}

export interface StatusCell {
	tone: StatusTone
	/** Catalog key of the status label. */
	labelKey: string
}

/** A text cell may hold several texts, shown joined by ` · `. */
export type DataCell =
	| CellText
	| readonly CellText[]
	| number
	| bigint
	| Date
	| StatusCell
	| undefined

export interface DataRow {
	id: string
	/** The row's page: the whole list item, or the whole table row, opens it. */
	href?: string
	/** A line beside the title (type, performers): above it in the list, under it in the table. */
	subtitle?: readonly CellText[]
	cells: Record<string, DataCell>
}

/**
 * A collection of records: an M3 list while the list itself is narrower than
 * 840 px, a table from 840 px (a container query, so a list in a narrow pane
 * stays a list; design D3, D18). Both forms come from the same data and are
 * separate markup, so a wide list is a real table to screen readers and a
 * narrow one a real list.
 *
 * A row with `href` is one target in both forms: the whole list item is its
 * link, and in the table the row header's link is stretched over the row.
 * In the list the primary cell is the headline, the subtitle the overline,
 * every other column a supporting line (counts and prices with their column
 * title) and a `trailing` column the trailing status. Column titles, statuses
 * and catalog texts are translated in the template.
 */
export class DataList {
	@bindable public columns: DataColumn[] = []
	@bindable public rows: DataRow[] = []
	/** Accessible name of the list and the table caption. */
	@bindable public label = ''

	public get primary(): DataColumn | undefined {
		return this.columns.find((c) => c.primary) ?? this.columns[0]
	}

	/** The list item's supporting lines, in column order. */
	public get supporting(): DataColumn[] {
		const primary = this.primary
		return this.columns.filter((c) => c !== primary && !c.trailing)
	}

	/** The list item's trailing column, if any. */
	public get trailing(): DataColumn | undefined {
		return this.columns.find((c) => c.trailing && c !== this.primary)
	}

	public isNumeric(column: DataColumn): boolean {
		return column.kind === 'count' || column.kind === 'yen'
	}
}
