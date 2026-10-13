import { bindable } from 'aurelia'
import type { StatusTone } from '../status-badge/status-badge'

export type DataCellKind =
	| 'text'
	| 'count'
	| 'yen'
	| 'datetime'
	| 'date'
	| 'status'

export interface DataColumn {
	key: string
	label: string
	kind?: DataCellKind
	/** The row's title: the card heading, and the link to the row's page. */
	primary?: boolean
}

export interface StatusCell {
	tone: StatusTone
	label: string
}

export type DataCell = string | number | bigint | Date | StatusCell | undefined

export interface DataRow {
	id: string
	/** The row's page; its primary cell links there. */
	href?: string
	/** A secondary line under the primary cell (type, performers). */
	subtitle?: string
	cells: Record<string, DataCell>
}

/**
 * A list of records shown as cards, and as a table once the list itself is at
 * least 840 px wide (a container query, so a list in a narrow pane stays
 * cards). Both forms come from the same data and are separate markup, so a
 * wide list is a real table to screen readers and a narrow one a real list.
 */
export class DataList {
	@bindable public columns: DataColumn[] = []
	@bindable public rows: DataRow[] = []
	/** Accessible name of the list and the table caption. */
	@bindable public label = ''

	public get primary(): DataColumn | undefined {
		return this.columns.find((c) => c.primary) ?? this.columns[0]
	}

	public get details(): DataColumn[] {
		const primary = this.primary
		return this.columns.filter((c) => c !== primary)
	}

	public isNumeric(column: DataColumn): boolean {
		return column.kind === 'count' || column.kind === 'yen'
	}
}
