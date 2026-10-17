// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { PhysicsBubble } from './bubble-physics'
import { RevealMarks } from './reveal-marks'

function bubble(
	id: string,
	opts: { ghost?: boolean; opacity?: number; fadingOut?: boolean } = {},
): PhysicsBubble {
	return {
		body: { position: { x: 0, y: 0 } },
		artist: { id, name: id, mbid: '', isGhost: opts.ghost },
		radius: 40,
		scale: 1,
		opacity: opts.opacity ?? 1,
		isSpawning: false,
		spawnProgress: 1,
		isFadingOut: opts.fadingOut ?? false,
		fadeOutProgress: 0,
	} as PhysicsBubble
}

const ghost = (i: number, fadingOut = false) =>
	bubble(`__ghost__${i}`, { ghost: true, fadingOut })

describe('RevealMarks', () => {
	it('fires ghosts, then first-name, then all-names, each once', () => {
		const sut = new RevealMarks()

		expect(sut.observe([ghost(0), ghost(1)])).toEqual(['ghosts'])
		expect(sut.observe([ghost(0), ghost(1)])).toEqual([])
		// A real artist still below the label threshold draws no name yet.
		expect(sut.observe([bubble('a', { opacity: 0.3 }), ghost(1)])).toEqual([])
		expect(sut.observe([bubble('a'), ghost(1)])).toEqual(['first-name'])
		expect(sut.observe([bubble('a'), bubble('b', { opacity: 0.5 })])).toEqual(
			[],
		)
		expect(sut.observe([bubble('a'), bubble('b')])).toEqual(['all-names'])
		expect(sut.observe([bubble('a'), bubble('b')])).toEqual([])
	})

	it('ignores ghosts that are fading out when deciding all-names', () => {
		const sut = new RevealMarks()
		sut.observe([ghost(0), ghost(1)])

		expect(sut.observe([bubble('a'), ghost(1, true)])).toEqual([
			'first-name',
			'all-names',
		])
	})

	it('fires nothing for a field that never drew a ghost (re-entry)', () => {
		const sut = new RevealMarks()

		expect(sut.observe([bubble('a'), bubble('b')])).toEqual([])
		expect(sut.observe([ghost(0)])).toEqual(['ghosts'])
	})

	it('does not fire all-names for an empty field', () => {
		const sut = new RevealMarks()
		sut.observe([ghost(0)])

		expect(sut.observe([])).toEqual([])
	})
})
