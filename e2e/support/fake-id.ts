/**
 * Deterministic UUID for a readable fixture key such as `c-4` or `h-150-0`.
 *
 * Entity IDs are UUIDs in the proto contract, and the client-side validation
 * interceptor rejects any request that carries something else — so an ID a
 * fixture hands to the app (and the app later sends back, e.g. a deep-linked
 * concert) must be UUID-shaped. The same key always yields the same UUID, so
 * a test can build an ID in a mock and reference it again in a URL.
 */
export function fakeId(key: string): string {
	// 48-bit FNV-1a: enough to keep the fixture keys of one test distinct.
	let hash = 0xcbf29ce484222325n
	for (const ch of key) {
		hash ^= BigInt(ch.codePointAt(0) ?? 0)
		hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
	}
	const node = (hash & 0xffffffffffffn).toString(16).padStart(12, '0')
	return `00000000-0000-4000-8000-${node}`
}
