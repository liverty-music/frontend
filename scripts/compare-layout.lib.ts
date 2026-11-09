/**
 * Compares two layout records (`e2e/support/layout-record.ts`) of one test.
 *
 * Elements match by their own tag and classes in document order, not by their
 * full path, so a wrapper added around them does not count as a change. A
 * moved parent moves its children by the same amount; each distinct shift is
 * reported once, at the shallowest element that has it.
 */

export type LayoutRecord = Record<string, number[]>

export interface Shift {
	/** The shallowest element with this shift, as `parent/element`. */
	element: string
	/** Change of x, y, width and height, in px. */
	delta: [number, number, number, number]
}

const leaf = (key: string): string =>
	(key.split('/').pop() ?? key).replace(/\[\d+\]$/, '').replace(/#shadow$/, '')

/** Elements keyed by their own name and its occurrence in document order. */
function byName(
	record: LayoutRecord,
): Map<string, { key: string; box: number[] }> {
	const seen = new Map<string, number>()
	const out = new Map<string, { key: string; box: number[] }>()
	for (const [key, box] of Object.entries(record)) {
		const name = leaf(key)
		const n = seen.get(name) ?? 0
		seen.set(name, n + 1)
		out.set(`${name}#${n}`, { key, box })
	}
	return out
}

/** The distinct shifts between two records, beyond `tolerance` px. */
export function compareLayouts(
	before: LayoutRecord,
	after: LayoutRecord,
	tolerance = 0.5,
): Shift[] {
	const later = byName(after)
	const shallowest = new Map<string, { depth: number; key: string }>()
	const deltas = new Map<string, Shift['delta']>()
	for (const [id, { key, box }] of byName(before)) {
		const match = later.get(id)
		if (!match) continue
		const delta = box.map((v, i) => match.box[i] - v) as Shift['delta']
		if (delta.every((d) => Math.abs(d) <= tolerance)) continue
		const signature = delta.join(',')
		const depth = key.split('/').length
		const current = shallowest.get(signature)
		if (!current || depth < current.depth) {
			shallowest.set(signature, { depth, key })
			deltas.set(signature, delta)
		}
	}
	return [...shallowest].map(([signature, { key }]) => ({
		element: key.split('/').filter(Boolean).slice(-2).join('/'),
		delta: deltas.get(signature) as Shift['delta'],
	}))
}
