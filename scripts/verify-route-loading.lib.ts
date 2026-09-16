/**
 * Asserts that no route holds the view swap on its data.
 *
 * The router awaits a route's `loading()` hook before swapping views, so an
 * `await` on network work there freezes the OUTGOING screen until the network
 * answers. `non-blocking-menu-navigation` forbids it, `my-artists-route.ts`
 * documents the correct shape at its call site — and Settings still drifted into
 * awaiting two RPCs, because nothing checked. This is that check.
 *
 * Deliberate exceptions exist (a route that must not show a step the fan is not
 * eligible for), so they are named here rather than silently tolerated: an
 * exception has to be argued for once, in this file, where it can be reviewed.
 *
 * Pure and dependency-free so it can be unit-tested; the entry point maps the
 * result to console output and an exit code.
 */

export interface RouteLoadingFailure {
	file: string
	line: number
	kind: 'awaits-in-loading' | 'assigns-cache-in-loading'
	detail: string
}

export type RouteLoadingResult =
	| { kind: 'ok'; checked: number }
	| { kind: 'failed'; checked: number; failures: RouteLoadingFailure[] }

/**
 * Routes allowed to block, with the reason. Keep this short: every entry is a
 * screen that freezes while the network answers.
 */
export const BLOCKING_ALLOWLIST: Record<string, string> = {
	'lottery-apply-route.ts':
		'Parks an unverified fan on verify-required before any card hold — starting them in the payment flow and yanking them out is worse than the wait.',
	'verify-callback-route.ts':
		'An OIDC-style callback whose entire purpose is to resolve an outcome and redirect; there is no view to show in the meantime.',
}

/** Extract the body of a method, by brace matching from its opening `{`. */
function methodBody(source: string, methodStart: number): string | null {
	const open = source.indexOf('{', methodStart)
	if (open === -1) return null
	let depth = 0
	for (let i = open; i < source.length; i++) {
		const ch = source[i]
		if (ch === '{') depth++
		else if (ch === '}') {
			depth--
			if (depth === 0) return source.slice(open + 1, i)
		}
	}
	return null
}

/**
 * Blank out nested function bodies so only statements in THIS scope are
 * examined. An `await` inside a callback runs after the hook has already
 * returned, so it holds nothing — flagging it would be a false positive.
 *
 * Replaced with spaces rather than removed so byte offsets, and therefore
 * reported line numbers, still line up with the original.
 */
function withoutNestedFunctions(body: string): string {
	const opener = /(=>\s*\{|\bfunction\b[^{;]*\{)/g
	const chars = [...body]
	let m: RegExpExecArray | null = opener.exec(body)

	while (m !== null) {
		const open = body.indexOf('{', m.index)
		let depth = 0
		let end = -1
		for (let i = open; i < body.length; i++) {
			if (body[i] === '{') depth++
			else if (body[i] === '}') {
				depth--
				if (depth === 0) {
					end = i
					break
				}
			}
		}
		if (end === -1) break

		for (let i = m.index; i <= end; i++) {
			if (chars[i] !== '\n') chars[i] = ' '
		}
		opener.lastIndex = end + 1
		m = opener.exec(body)
	}

	return chars.join('')
}

function lineOf(source: string, index: number): number {
	return source.slice(0, index).split('\n').length
}

export function checkRouteLoading(
	files: { path: string; source: string }[],
): RouteLoadingResult {
	const failures: RouteLoadingFailure[] = []

	for (const { path, source } of files) {
		const basename = path.split('/').pop() ?? path
		if (basename in BLOCKING_ALLOWLIST) continue

		const match = /\b(?:public\s+)?(?:async\s+)?loading\s*\(/.exec(source)
		if (!match) continue

		const body = methodBody(source, match.index)
		if (body === null) continue
		const own = withoutNestedFunctions(body)

		// `await` directly in the hook's own scope.
		const awaitRe = /\bawait\b/g
		let m: RegExpExecArray | null = awaitRe.exec(own)
		while (m !== null) {
			failures.push({
				file: path,
				line: lineOf(source, match.index) + lineOf(own, m.index) - 1,
				kind: 'awaits-in-loading',
				detail:
					'`await` inside loading() holds the router‘s view swap, freezing the outgoing screen until it resolves. Start the work with `void` instead, or add the route to BLOCKING_ALLOWLIST with a reason.',
			})
			m = awaitRe.exec(own)
		}

		// Assigning a cache read to render state puts the full render inside the
		// component's first render, which is the same freeze by a different route.
		// Narrow by design: it matches the cache-read shape (`peek*` / `getCached*`)
		// rather than guessing which fields the template renders, so it reports no
		// false positives and does not catch every possible instance.
		const cacheRe = /this\.(\w+)\s*=\s*[^=\n]*\b(peek\w*|getCached\w*)\s*\(/g
		let c: RegExpExecArray | null = cacheRe.exec(own)
		while (c !== null) {
			failures.push({
				file: path,
				line: lineOf(source, match.index) + lineOf(own, c.index) - 1,
				kind: 'assigns-cache-in-loading',
				detail: `\`this.${c[1]}\` is assigned from a cache read inside loading(), a pre-activation hook — the component's first render then contains the whole thing. Reflect it from the component lifecycle instead.`,
			})
			c = cacheRe.exec(own)
		}
	}

	return failures.length > 0
		? { kind: 'failed', checked: files.length, failures }
		: { kind: 'ok', checked: files.length }
}
