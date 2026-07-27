import { describe, expect, it, vi } from 'vitest'
import { CachedResource } from './cached-resource'

interface TopInput {
	country: string
	tag: string
	limit: number
}

function makeResource(fetch: (input: TopInput) => Promise<number>) {
	return new CachedResource<TopInput, number>(
		({ country, tag, limit }) => `${country}|${tag}|${limit}`,
		(input) => fetch(input),
	)
}

describe('CachedResource', () => {
	it('reads through the cache (one fetch for repeated fresh reads)', async () => {
		const fetch = vi.fn(async () => 1)
		const res = makeResource(fetch)
		const input = { country: 'JP', tag: 'rock', limit: 30 }

		await res.read(input)
		await res.read(input)

		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('keys on every input field (limit distinguishes entries)', async () => {
		const fetch = vi
			.fn<(i: TopInput) => Promise<number>>()
			.mockResolvedValueOnce(10)
			.mockResolvedValueOnce(20)
		const res = makeResource(fetch)

		const a = await res.read({ country: 'JP', tag: 'rock', limit: 30 })
		const b = await res.read({ country: 'JP', tag: 'rock', limit: 50 })

		expect(a).toBe(10)
		expect(b).toBe(20)
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('revalidate() forces a refetch even for a fresh entry', async () => {
		const fetch = vi
			.fn<(i: TopInput) => Promise<number>>()
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(2)
		const res = makeResource(fetch)
		const input = { country: 'JP', tag: '', limit: 30 }

		await res.read(input)
		const fresh = await res.revalidate(input)

		expect(fresh).toBe(2)
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('has() reflects cache presence; invalidate() forces the next read to refetch', async () => {
		const fetch = vi.fn(async () => 1)
		const res = makeResource(fetch)
		const input = { country: 'JP', tag: '', limit: 30 }

		expect(res.has(input)).toBe(false)
		await res.read(input)
		expect(res.has(input)).toBe(true)

		res.invalidate(input)
		expect(res.has(input)).toBe(false)
		await res.read(input)
		expect(fetch).toHaveBeenCalledTimes(2)
	})
})
