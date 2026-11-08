// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { type RevealFrame, RevealMarks } from './reveal-marks'

/** One bubble as a frame drew it. */
interface Drawn {
	ghost?: boolean
	/** The body was drawn (default true). */
	body?: boolean
	/** The artist name was drawn (default: a drawn artist). */
	name?: boolean
	fadingOut?: boolean
}

function frame(bubbles: Drawn[]): RevealFrame {
	const f: RevealFrame = { drawn: 0, named: 0, live: 0, liveNamed: 0 }
	for (const b of bubbles) {
		const body = b.body ?? true
		const name = b.name ?? (body && !b.ghost)
		if (body) f.drawn++
		if (name) f.named++
		if (b.fadingOut) continue
		f.live++
		if (name) f.liveNamed++
	}
	return f
}

const ghost = (fadingOut = false): Drawn => ({ ghost: true, fadingOut })
const artist: Drawn = {}

describe('RevealMarks', () => {
	it('fires ghosts, then first-name, then all-names, each once', () => {
		const sut = new RevealMarks()

		expect(sut.observe(frame([ghost(), ghost()]))).toEqual(['ghosts'])
		expect(sut.observe(frame([ghost(), ghost()]))).toEqual([])
		// A real artist whose name is not drawn yet.
		expect(sut.observe(frame([{ name: false }, ghost()]))).toEqual([])
		expect(sut.observe(frame([artist, ghost()]))).toEqual(['first-name'])
		expect(sut.observe(frame([artist, { name: false }]))).toEqual([])
		expect(sut.observe(frame([artist, artist]))).toEqual(['all-names'])
		expect(sut.observe(frame([artist, artist]))).toEqual([])
		expect(sut.done).toBe(true)
	})

	it('ignores ghosts that are fading out when deciding all-names', () => {
		const sut = new RevealMarks()
		sut.observe(frame([ghost(), ghost()]))

		expect(sut.observe(frame([artist, ghost(true)]))).toEqual([
			'first-name',
			'all-names',
		])
	})

	it('fires every milestone on the first frame when artists arrive before any ghost is drawn', () => {
		const sut = new RevealMarks()

		expect(sut.observe(frame([artist, artist]))).toEqual([
			'ghosts',
			'first-name',
			'all-names',
		])
	})

	it('fires nothing before any bubble is drawn', () => {
		const sut = new RevealMarks()

		expect(sut.observe(frame([]))).toEqual([])
		expect(sut.observe(frame([{ body: false, name: false }]))).toEqual([])
	})

	it('does not fire all-names for an empty field', () => {
		const sut = new RevealMarks()
		sut.observe(frame([ghost()]))

		expect(sut.observe(frame([]))).toEqual([])
	})

	// @spec components/infrastructure/fan/web/route/discovery "A name appears after its bubble"
	it('takes the name marks from the frames in which the names appeared, not from the bubble', () => {
		const sut = new RevealMarks()

		// The artist bubbles are fully shown, their names not on screen yet.
		expect(sut.observe(frame([{ name: false }, { name: false }]))).toEqual([
			'ghosts',
		])
		expect(sut.observe(frame([{ name: false }, { name: false }]))).toEqual([])
		// One name appears, then the other.
		expect(sut.observe(frame([artist, { name: false }]))).toEqual([
			'first-name',
		])
		expect(sut.observe(frame([artist, artist]))).toEqual(['all-names'])
	})
})
