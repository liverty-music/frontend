import { describe, expect, it } from 'vitest'
import {
	groupHomeItems,
	type HomeItem,
} from '../../../organizer/model/home-model'

const item = (kind: HomeItem['kind'], key: string): HomeItem => ({
	kind,
	key,
	actionHref: `/${key}`,
})

describe('groupHomeItems', () => {
	it('puts the items of each kind under one subheader, in order', () => {
		const groups = groupHomeItems([
			item('payout', 'payout'),
			item('scanner', 'scanner:a'),
			item('scanner', 'scanner:b'),
			item('draft', 'draft:x'),
		])
		expect(groups.map((g) => [g.kind, g.items.map((i) => i.key)])).toEqual([
			['payout', ['payout']],
			['scanner', ['scanner:a', 'scanner:b']],
			['draft', ['draft:x']],
		])
	})

	it('has no group without items', () => {
		expect(groupHomeItems([])).toEqual([])
	})
})
