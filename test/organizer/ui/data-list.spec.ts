import { describe, expect, it } from 'vitest'
import {
	type DataColumn,
	DataList,
} from '../../../organizer/ui/data-list/data-list'

const columns: DataColumn[] = [
	{ key: 'date', labelKey: 'concert.column.date', primary: true },
	{ key: 'venue', labelKey: 'concert.column.venue' },
	{ key: 'sale', labelKey: 'concert.column.sale', kind: 'status' },
	{ key: 'entries', labelKey: 'sale.stats.entries', kind: 'count' },
	{
		key: 'state',
		labelKey: 'concert.column.state',
		kind: 'status',
		trailing: true,
	},
]

describe('DataList as a list', () => {
	it('heads each item with the primary column and trails its status', () => {
		const list = new DataList()
		list.columns = columns
		expect(list.primary?.key).toBe('date')
		expect(list.supporting.map((c) => c.key)).toEqual([
			'venue',
			'sale',
			'entries',
		])
		expect(list.trailing?.key).toBe('state')
		expect(list.isNumeric(columns[3])).toBe(true)
		expect(list.isNumeric(columns[1])).toBe(false)
	})

	it('falls back to the first column and has no trailing one by default', () => {
		const list = new DataList()
		list.columns = [
			{ key: 'title', labelKey: 'concerts.column.title' },
			{ key: 'price', labelKey: 'lotteryEditor.price', kind: 'yen' },
		]
		expect(list.primary?.key).toBe('title')
		expect(list.supporting.map((c) => c.key)).toEqual(['price'])
		expect(list.trailing).toBeUndefined()
	})
})
