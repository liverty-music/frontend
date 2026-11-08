/**
 * Measures cold loads of a production build on the cold-load reference setup
 * of the Discovery spec ("Cold load meets a time budget"): a 375 px viewport,
 * DevTools' "Slow 4G" network, 4x CPU throttling, the HTTP cache enabled, on a
 * repeat visit (one warm-up load caches the app's code first).
 *
 *   npm run build
 *   node scripts/measure-cold-load.ts [options]
 *
 * Options:
 *   --dist <dir>     build to serve (default: dist)
 *   --route <path>   /discovery (default) or /dashboard
 *   --fan <who>      guest (default) or signed-in (follows 5 artists)
 *   --runs <n>       loads after the warm-up (default: 10)
 *   --cdp <url>      drive an already running Chrome over the DevTools
 *                    protocol (see "Measuring Discovery's frame rate" in
 *                    README.md) instead of launching Playwright's Chromium
 *   --long <ms>      list the long animation frames before the first route
 *                    paint that are longer than this (default: 50), with
 *                    their scripts
 *   --json <file>    append one JSON line per load to <file>
 *   --trace <file>   save a DevTools trace of the first measured load, with
 *                    the JavaScript stack of each style and layout
 *
 * The network is mocked inside the page (a `fetch` replacement answering the
 * RPCs and the identity provider after a delay standing in for Slow 4G's
 * round trip): Playwright's request routing would disable the HTTP cache.
 * Analytics and third-party hosts are blocked. `config.json` is served with
 * `logLevel: info`, and no service worker runs.
 *
 * Reported per load: the cold-load reveal marks of Discovery (`ghosts`,
 * `first-name`), the first contentful paint, and the long animation frames
 * that started before the first route paint (Discovery: the first bubble;
 * Dashboard: the first contentful paint after the route's content).
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { type Browser, chromium, type Page } from '@playwright/test'

const { values: args } = parseArgs({
	options: {
		dist: { type: 'string', default: 'dist' },
		route: { type: 'string', default: '/discovery' },
		fan: { type: 'string', default: 'guest' },
		runs: { type: 'string', default: '10' },
		cdp: { type: 'string' },
		long: { type: 'string', default: '50' },
		json: { type: 'string' },
		trace: { type: 'string' },
	},
})

const DIST = resolve(args.dist ?? 'dist')
const ROUTE = args.route ?? '/discovery'
const SIGNED_IN = args.fan === 'signed-in'
const RUNS = Number(args.runs)
const LONG_MS = Number(args.long)

// DevTools' "Slow 4G" preset (front_end/core/sdk/NetworkManager.ts).
const SLOW_4G = {
	offline: false,
	latency: 150 * 3.75,
	downloadThroughput: ((1.4 * 1000 * 1000) / 8) * 0.9,
	uploadThroughput: ((0.675 * 1000 * 1000) / 8) * 0.9,
}

const TYPES: Record<string, string> = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.html': 'text/html',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.webmanifest': 'application/manifest+json',
}

function serve(dir: string): Promise<Server> {
	const server = createServer(async (req, res) => {
		const path = new URL(req.url ?? '/', 'http://x').pathname
		if (path === '/sw.js') {
			res.writeHead(404)
			res.end()
			return
		}
		let file = join(dir, normalize(decodeURIComponent(path)))
		if (!file.startsWith(dir)) file = join(dir, 'index.html')
		try {
			if (!(await stat(file)).isFile()) throw new Error('not a file')
		} catch {
			file = join(dir, 'index.html')
		}
		const type = TYPES[extname(file)] ?? 'application/octet-stream'
		// Cache headers and compression as the production Caddyfile sets them:
		// hashed assets immutable, config.json never cached, other files with
		// only Caddy's Last-Modified (cached by the browser's heuristic), text
		// gzipped.
		const cache = file.includes('/assets/')
			? 'public, max-age=31536000, immutable'
			: file.endsWith('config.json')
				? 'no-store'
				: null
		let body: Buffer = await readFile(file)
		if (file.endsWith('config.json')) {
			const config = JSON.parse(body.toString('utf8'))
			body = Buffer.from(JSON.stringify({ ...config, logLevel: 'info' }))
		}
		const headers: Record<string, string> = { 'content-type': type }
		if (cache) headers['cache-control'] = cache
		else headers['last-modified'] = (await stat(file)).mtime.toUTCString()
		const text = /^(text|application\/(json|manifest))|svg/.test(type)
		if (text && /gzip/.test(String(req.headers['accept-encoding']))) {
			body = gzipSync(body)
			headers['content-encoding'] = 'gzip'
		}
		res.writeHead(200, headers)
		res.end(body)
	})
	return new Promise((ok) => server.listen(0, () => ok(server)))
}

interface LongFrame {
	start: number
	duration: number
	blocking: number
	render: number
	scripts: {
		duration: number
		invoker: string
		fn: string
		url: string
		char: number
		layout: number
	}[]
}

/**
 * Runs before the app: answers the RPCs and the identity provider from
 * `fetch` after `rtt` ms, seeds the fan, and records long animation frames.
 */
function probe(opts: { rtt: number; signedIn: boolean }): void {
	const ids = (n: number, p: string) =>
		Array.from({ length: n }, (_, i) => ({
			id: {
				value: `0190${p}000-0000-7000-8000-${String(i).padStart(12, '0')}`,
			},
			name: { value: `Artist ${p}${i}` },
			mbid: { value: '' },
		}))
	try {
		localStorage.setItem('onboarding.helpSeen:discovery', '1')
		localStorage.setItem('onboarding.helpSeen:dashboard', '1')
		localStorage.setItem('pwa.installed', 'true')
		if (opts.signedIn) {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem(
				'oidc.user:https://auth.dev.liverty-music.app:371355407710421859',
				JSON.stringify({
					id_token: 'fake-id-token',
					access_token: 'fake-access-token',
					token_type: 'Bearer',
					scope: 'openid profile email',
					profile: { sub: '00000000-0000-4000-8000-d00000000002' },
					expires_at: 9999999999,
				}),
			)
		}
	} catch {}
	const answer = (url: string): unknown => {
		if (url.includes('openid-configuration')) {
			const o = new URL(url).origin
			return {
				issuer: o,
				authorization_endpoint: `${o}/oauth/v2/authorize`,
				token_endpoint: `${o}/oauth/v2/token`,
				userinfo_endpoint: `${o}/oidc/v1/userinfo`,
				end_session_endpoint: `${o}/oidc/v1/end_session`,
				jwks_uri: `${o}/oauth/v2/keys`,
			}
		}
		if (url.includes('UserService/Get')) {
			return {
				user: {
					id: { value: '00000000-0000-4000-8000-d00000000002' },
					email: { value: 'fan@example.com' },
					home: { countryCode: 'JP', level1: 'JP-13' },
				},
			}
		}
		if (url.includes('FollowService/List')) {
			return {
				artists: ids(5, 'f').map((artist) => ({ artist, hype: 2 })),
			}
		}
		if (url.includes('ListTop')) return { artists: ids(50, 'a') }
		if (url.includes('ListSimilar')) {
			return { artists: ids(30, `s${Math.floor(Math.random() * 1e6)}x`) }
		}
		return {}
	}
	const real = window.fetch.bind(window)
	window.fetch = async (input, init) => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url
		if (url.includes('liverty_music.rpc.') || url.includes('auth.')) {
			await new Promise((r) => setTimeout(r, opts.rtt))
			return new Response(JSON.stringify(answer(url)), {
				headers: { 'content-type': 'application/json' },
			})
		}
		return real(input, init)
	}
	const frames: LongFrame[] = []
	;(window as unknown as { __longFrames: LongFrame[] }).__longFrames = frames
	new PerformanceObserver((list) => {
		for (const e of list.getEntries()) {
			const f = e as unknown as {
				startTime: number
				duration: number
				blockingDuration: number
				renderStart: number
				scripts: {
					duration: number
					invoker: string
					sourceFunctionName: string
					sourceURL: string
					sourceCharPosition: number
					forcedStyleAndLayoutDuration: number
				}[]
			}
			frames.push({
				start: Math.round(f.startTime),
				duration: Math.round(f.duration),
				blocking: Math.round(f.blockingDuration),
				render: f.renderStart
					? Math.round(f.startTime + f.duration - f.renderStart)
					: 0,
				scripts: f.scripts.map((s) => ({
					duration: Math.round(s.duration),
					invoker: s.invoker,
					fn: s.sourceFunctionName,
					url: s.sourceURL.split('/').pop() ?? '',
					char: s.sourceCharPosition,
					layout: Math.round(s.forcedStyleAndLayoutDuration),
				})),
			})
		}
	}).observe({ type: 'long-animation-frame', buffered: true })
}

async function load(browser: Browser, port: number, n: number) {
	const context = await browser.newContext({
		viewport: { width: 375, height: 812 },
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true,
		serviceWorkers: 'block',
		locale: 'ja-JP',
	})
	await context.addInitScript(probe, {
		rtt: SLOW_4G.latency,
		signedIn: SIGNED_IN,
	})
	const url = `http://localhost:${port}${ROUTE}`
	const open = async (beforeGoto?: (page: Page) => Promise<void>) => {
		const page = await context.newPage()
		const cdp = await context.newCDPSession(page)
		await cdp.send('Network.enable')
		await cdp.send('Network.setBlockedURLs', {
			urls: [
				'*posthog.com*',
				'*audioscrobbler*',
				'*fanart.tv*',
				'*stripe.com*',
			],
		})
		await cdp.send('Network.emulateNetworkConditions', SLOW_4G)
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
		const errors: string[] = []
		page.on('pageerror', (e) => errors.push(e.message))
		await beforeGoto?.(page)
		await page.goto(url, { waitUntil: 'commit' })
		return { page, errors }
	}
	// Warm-up: the first visit downloads and caches the app's code, including
	// the chunks imported after the load event.
	const warm = await open()
	await warm.page.waitForLoadState('load', { timeout: 120_000 })
	await warm.page.waitForLoadState('networkidle', { timeout: 120_000 })
	await warm.page.close()

	const tracing = Boolean(args.trace) && n === 0
	const { page, errors } = await open(async (p) => {
		if (!tracing) return
		await browser.startTracing(p, {
			categories: [
				'devtools.timeline',
				'disabled-by-default-devtools.timeline',
				'disabled-by-default-devtools.timeline.stack',
				'v8.execute',
				'blink.user_timing',
				'disabled-by-default-v8.cpu_profiler',
			],
		})
	})
	if (ROUTE === '/discovery') {
		await page.waitForFunction(
			() => performance.getEntriesByName('discovery:first-name').length > 0,
			null,
			{ timeout: 120_000 },
		)
	} else {
		await page.waitForLoadState('load', { timeout: 120_000 })
		await page.waitForTimeout(4000)
	}
	await page.waitForTimeout(500)
	if (tracing && args.trace) {
		writeFileSync(args.trace, await browser.stopTracing())
	}
	const result = await page.evaluate(() => {
		const mark = (m: string) => {
			const e = performance.getEntriesByName(`discovery:${m}`)[0]
			return e ? Math.round(e.startTime) : null
		}
		const fcp = performance.getEntriesByName('first-contentful-paint')[0]
		return {
			ghosts: mark('ghosts'),
			firstName: mark('first-name'),
			fcp: fcp ? Math.round(fcp.startTime) : null,
			frames: (window as unknown as { __longFrames: LongFrame[] }).__longFrames,
		}
	})
	await context.close()
	const firstPaint = result.ghosts ?? result.fcp ?? Number.POSITIVE_INFINITY
	const before = result.frames.filter(
		(f) => f.start < firstPaint && f.duration > LONG_MS,
	)
	return {
		route: ROUTE,
		fan: SIGNED_IN ? 'signed-in' : 'guest',
		run: n + 1,
		ghosts_ms: result.ghosts,
		first_name_ms: result.firstName,
		fcp_ms: result.fcp,
		longFramesBeforeFirstPaint: before,
		errors,
	}
}

function median(values: (number | null)[]): number | null {
	const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b)
	if (v.length === 0) return null
	const mid = Math.floor(v.length / 2)
	return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2)
}

async function main(): Promise<void> {
	await stat(join(DIST, 'index.html')).catch(() => {
		throw new Error(`No build at ${DIST}; run npm run build first`)
	})
	const server = await serve(DIST)
	const { port } = server.address() as AddressInfo
	const browser = args.cdp
		? await chromium.connectOverCDP(args.cdp)
		: await chromium.launch()
	const results: Awaited<ReturnType<typeof load>>[] = []
	try {
		for (let n = 0; n < RUNS; n++) {
			const r = await load(browser, port, n)
			results.push(r)
			if (args.json) appendFileSync(args.json, `${JSON.stringify(r)}\n`)
			console.log(
				`${r.fan} ${r.route} #${r.run}  ghosts ${r.ghosts_ms} | first-name ${r.first_name_ms} | fcp ${r.fcp_ms} | long frames before first paint: ${r.longFramesBeforeFirstPaint.map((f) => f.duration).join(', ') || 'none'}${r.errors.length ? ` | ${r.errors.length} page errors` : ''}`,
			)
		}
	} finally {
		if (!args.cdp) await browser.close()
		server.close()
	}
	console.log(
		`\nmedians over ${results.length} loads: ghosts ${median(results.map((r) => r.ghosts_ms))} ms | first-name ${median(results.map((r) => r.first_name_ms))} ms | fcp ${median(results.map((r) => r.fcp_ms))} ms`,
	)
}

await main()
