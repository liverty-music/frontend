/**
 * Measures the frames of Discovery's bubble field in a production build: a
 * guest's field of 50 artists, idle and after a tap on a bubble.
 *
 *   npm run build
 *   npx tsx scripts/measure-discovery-frames.ts [options]
 *
 * Options:
 *   --dist <dir>       build to serve (default: dist)
 *   --runs <n>         rounds, each in a fresh browser context (default: 5)
 *   --cdp <url>        drive an already running Chrome over the DevTools
 *                      protocol (e.g. http://127.0.0.1:9222) instead of
 *                      launching Playwright's Chromium; see "Measuring
 *                      Discovery's frame rate" in README.md
 *   --throttle <n>     CPU throttling rate (default: 4)
 *   --dpr <n>          device pixel ratio of the emulated device (default: 2)
 *   --trace            also count layout, style and paint events while idle
 *   --stills <dir>     instead of measuring, draw still frames from fixed
 *                      inputs once the field is revealed (the field, a
 *                      half-revealed field, an absorbing bubble, and the field
 *                      drawn without sprites) and save them as .rgba and .png
 *                      in <dir>
 *   --compare <a> <b>  compare the still frames of two --stills directories
 *   --label <text>     name printed with the results (default: the dist dir)
 *   --json <file>      append one JSON line per round to <file>
 *
 * Setup (the frame reference setup of the discovery spec): a 412 px wide
 * viewport, CPU throttled 4x, the network mocked (50 top artists, 30 similar
 * artists per tap, analytics and sign-in answered locally), `config.json`
 * served with `logLevel: info` as in production, and no service worker.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from '@playwright/test'

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		dist: { type: 'string', default: 'dist' },
		runs: { type: 'string', default: '5' },
		cdp: { type: 'string' },
		throttle: { type: 'string', default: '4' },
		dpr: { type: 'string', default: '2' },
		trace: { type: 'boolean', default: false },
		stills: { type: 'string' },
		compare: { type: 'boolean', default: false },
		label: { type: 'string' },
		json: { type: 'string' },
	},
})

const DIST = resolve(args.dist ?? 'dist')
const RUNS = Number(args.runs)
const THROTTLE = Number(args.throttle)
const DPR = Number(args.dpr)
const LABEL = args.label ?? args.dist ?? 'dist'
const VIEWPORT = { width: 412, height: 915 }
const IDLE_MS = 6000
const TAP_WINDOW_MS = 2500

// -- Mocked data ---------------------------------------------------------------

// biome-ignore format: a list of names
const NAMES = [
	'YOASOBI', 'King Gnu', 'ヨルシカ', '米津玄師', 'あいみょん', 'Vaundy',
	'back number', 'RADWIMPS', 'Official髭男dism', 'Mrs. GREEN APPLE', 'Ado',
	'藤井 風', 'SEKAI NO OWARI', 'ずっと真夜中でいいのに。', 'Creepy Nuts', '優里',
	'Aimer', 'LiSA', 'ONE OK ROCK', '[Alexandros]', '緑黄色社会',
	'マカロニえんぴつ', 'sumika', 'SUPER BEAVER', 'Saucy Dog', 'クリープハイプ',
	'ELLEGARDEN', 'BUMP OF CHICKEN', 'ASIAN KUNG-FU GENERATION', 'サカナクション',
	'星野源', '宇多田ヒカル', 'Perfume', 'きゃりーぱみゅぱみゅ', 'Mr.Children',
	'yama', 'Eve', 'tuki.', 'imase', 'Tani Yuuki', 'Novelbright', 'WurtS',
	'Omoinotake', 'Number_i', 'BE:FIRST', 'NewJeans', 'Snow Man', 'Hump Back',
	'羊文学', 'カネコアヤノ',
]

let similarCalls = 0

function artists(n: number, prefix: string): unknown {
	return {
		artists: Array.from({ length: n }, (_, i) => ({
			id: {
				value: `0190${prefix}000-0000-7000-8000-${String(i).padStart(12, '0')}`,
			},
			name: {
				value:
					prefix === 'a'
						? NAMES[i % NAMES.length]
						: `${NAMES[(i * 7) % NAMES.length]} ${prefix}${i}`,
			},
			mbid: { value: '' },
		})),
	}
}

// -- Static server -------------------------------------------------------------

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
		// No service worker: every round loads the build from this server.
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
		if (file.endsWith('config.json')) {
			// Production serves `logLevel: info`; debug logging adds 80-200 ms
			// to a tap (design.md "Context").
			const config = JSON.parse(await readFile(file, 'utf8'))
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ ...config, logLevel: 'info' }))
			return
		}
		res.writeHead(200, {
			'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
		})
		res.end(await readFile(file))
	})
	return new Promise((ok) => server.listen(0, () => ok(server)))
}

// -- In-page probe -------------------------------------------------------------

interface Window_ {
	__probe: {
		start(): void
		stop(): Sample
	}
}

interface Sample {
	intervals: number[]
	scripts: number[]
	loaf: number[]
	rects: number
}

/**
 * Runs before the app: wraps requestAnimationFrame to time each frame's
 * callbacks, records the intervals between frames, long animation frames and
 * getBoundingClientRect calls while recording.
 */
function probe(): void {
	const w = window as unknown as Window & Window_
	try {
		localStorage.setItem('onboarding.helpSeen:discovery', '1')
	} catch {}
	let rec = false
	let intervals: number[] = []
	let scripts: number[] = []
	let loaf: number[] = []
	let rects = 0
	const raf = w.requestAnimationFrame.bind(w)
	let frameScript = 0
	let frameAt = -1
	w.requestAnimationFrame = (cb) =>
		raf((t) => {
			const a = performance.now()
			try {
				cb(t)
			} finally {
				if (frameAt !== t) {
					if (rec && frameAt >= 0) scripts.push(frameScript)
					frameAt = t
					frameScript = 0
				}
				frameScript += performance.now() - a
			}
		})
	const rect = Element.prototype.getBoundingClientRect
	Element.prototype.getBoundingClientRect = function (this: Element) {
		if (rec) rects++
		return rect.call(this)
	}
	new PerformanceObserver((list) => {
		for (const e of list.getEntries()) if (rec) loaf.push(e.duration)
	}).observe({ type: 'long-animation-frame' })
	let last = 0
	const tick = (t: number) => {
		if (rec && last) intervals.push(t - last)
		last = t
		raf(tick)
	}
	raf(tick)
	w.__probe = {
		start() {
			intervals = []
			scripts = []
			loaf = []
			rects = 0
			rec = true
		},
		stop() {
			rec = false
			return { intervals, scripts, loaf, rects }
		},
	}
}

// -- Measurement ----------------------------------------------------------------

function quantile(values: number[], p: number): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	return round1(
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))],
	)
}

function round1(n: number): number {
	return Math.round(n * 10) / 10
}

function summarize(s: Sample) {
	const total = s.intervals.reduce((a, b) => a + b, 0)
	return {
		frames: s.intervals.length,
		fps: s.intervals.length ? round1(1000 / (total / s.intervals.length)) : 0,
		p50: quantile(s.intervals, 0.5),
		p95: quantile(s.intervals, 0.95),
		max: s.intervals.length ? Math.round(Math.max(...s.intervals)) : null,
		over50: s.intervals.filter((x) => x > 50).length,
		scriptP50: quantile(s.scripts, 0.5),
		scriptP95: quantile(s.scripts, 0.95),
		loaf: s.loaf.length,
		rectCalls: s.rects,
	}
}

async function mockNetwork(context: BrowserContext): Promise<void> {
	await context.route(/liverty_music\.rpc\./, (route) => {
		const url = route.request().url()
		let body: unknown = {}
		if (url.includes('ListTop')) body = artists(50, 'a')
		else if (url.includes('ListSimilar'))
			body = artists(30, `b${similarCalls++}`)
		return route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify(body),
		})
	})
	await context.route(/auth\.[a-z.]*liverty-music\.app/, (route) => {
		const origin = new URL(route.request().url()).origin
		return route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				issuer: origin,
				authorization_endpoint: `${origin}/a`,
				token_endpoint: `${origin}/t`,
				userinfo_endpoint: `${origin}/u`,
				end_session_endpoint: `${origin}/e`,
				jwks_uri: `${origin}/k`,
			}),
		})
	})
	await context.route(/posthog\.com|audioscrobbler|fanart\.tv/, (route) =>
		route.fulfill({ contentType: 'application/json', body: '{}' }),
	)
}

/** Count trace events by name while `during` runs. */
async function traceCounts(
	browser: Browser,
	page: Page,
	during: () => Promise<void>,
): Promise<Record<string, number>> {
	await browser.startTracing(page, {
		categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
	})
	const startedAt = Date.now()
	await during()
	const seconds = (Date.now() - startedAt) / 1000
	const buffer = await browser.stopTracing()
	const events = (
		JSON.parse(buffer.toString()) as {
			traceEvents: { name: string; ph: string }[]
		}
	).traceEvents
	const per = (name: string) =>
		round1(
			events.filter((e) => e.name === name && (e.ph === 'X' || e.ph === 'B'))
				.length / seconds,
		)
	return {
		layoutPerSec: per('Layout'),
		stylePerSec: per('UpdateLayoutTree'),
		paintPerSec: per('Paint'),
	}
}

async function round(browser: Browser, port: number, n: number) {
	similarCalls = 0
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: DPR,
		isMobile: true,
		hasTouch: true,
		serviceWorkers: 'block',
		locale: 'ja-JP',
	})
	await mockNetwork(context)
	await context.addInitScript(probe)
	const page = await context.newPage()
	const errors: string[] = []
	page.on('pageerror', (e) => errors.push(e.message))
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text())
	})
	const cdp = await context.newCDPSession(page)
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })

	await page.goto(`http://localhost:${port}/discovery`)
	await page.waitForFunction(
		() => performance.getEntriesByName('discovery:all-names').length > 0,
		null,
		{ timeout: 90_000 },
	)
	const marks = await page.evaluate(() =>
		Object.fromEntries(
			['ghosts', 'first-name', 'all-names'].map((m) => [
				m,
				Math.round(
					performance.getEntriesByName(`discovery:${m}`)[0]?.startTime ?? -1,
				),
			]),
		),
	)
	await page.waitForTimeout(1500)
	if (args.stills) {
		await saveStills(page, args.stills)
		await context.close()
		return null
	}

	const idleWindow = async () => {
		await page.evaluate(() => (window as unknown as Window_).__probe.start())
		await page.waitForTimeout(IDLE_MS)
		return page.evaluate(() => (window as unknown as Window_).__probe.stop())
	}
	let trace: Record<string, number> | undefined
	let idle: Sample
	if (args.trace) {
		let sample: Sample | undefined
		trace = await traceCounts(browser, page, async () => {
			sample = await idleWindow()
		})
		idle = sample as Sample
	} else {
		idle = await idleWindow()
	}

	const canvas = page.locator('dna-orb-canvas canvas')
	const box = await canvas.boundingBox()
	if (!box) throw new Error('no canvas')
	await page.evaluate(() => (window as unknown as Window_).__probe.start())
	await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3)
	await page.waitForTimeout(TAP_WINDOW_MS)
	const tap = await page.evaluate(() =>
		(window as unknown as Window_).__probe.stop(),
	)
	const gpu = await page.evaluate(() => {
		try {
			const gl = document.createElement('canvas').getContext('webgl')
			const ext = gl?.getExtension('WEBGL_debug_renderer_info')
			return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
		} catch {
			return ''
		}
	})
	await context.close()
	return {
		label: LABEL,
		round: n + 1,
		marks,
		idle: summarize(idle),
		tap: summarize(tap),
		...(trace ? { trace } : {}),
		errors,
		gpu,
	}
}

// -- Still frames ---------------------------------------------------------------

const STILLS = ['field', 'reveal', 'absorption', 'direct'] as const

/**
 * Draw still frames from fixed inputs with the build's own canvas code: the
 * loop paused, the orb layers and tap effects hidden, the field's bubbles
 * sorted by name and placed on a grid with fixed radii. Works on builds before
 * and after the sprites, which share these field names.
 */
async function saveStills(page: Page, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true })
	const draw = (step: (typeof STILLS)[number]) =>
		page.evaluate(async (step) => {
			// biome-ignore lint/suspicious/noExplicitAny: the build's own canvas fields, read by name
			type Vm = Record<string, any>
			const host = document.querySelector('dna-orb-canvas') as Element & {
				$au: Record<string, { viewModel: Vm }>
			}
			const vm = host.$au['au:resource:custom-element'].viewModel
			const canvas = host.shadowRoot?.querySelector(
				'canvas',
			) as HTMLCanvasElement
			const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
			const bubbles = (vm.physics.getBubbles() as Vm[])
				.filter((b) => !b.isFadingOut && !b.artist.isGhost)
				.sort((a, b) => (a.artist.name < b.artist.name ? -1 : 1))
				.slice(0, 20)
			if (step === 'field') {
				vm.pause()
				for (const k of [
					'renderGroundGlow',
					'renderLightRays',
					'render',
					'renderOrbitals',
					'renderShockwaves',
					'renderStrobeFlash',
				]) {
					vm.orbRenderer[k] = () => {}
				}
				vm.tapEffects.render = () => {}
				// Finish the measured tap's absorption and burst.
				vm.absorptionAnimator.update(60_000)
				vm.focusedBubbleIndex = -1
				for (const b of vm.physics.getBubbles() as Vm[]) b.opacity = 0
				bubbles.forEach((b, i) => {
					b.radius = 30 + ((i * 7) % 15)
					b.body.position.x = 50 + (i % 4) * 100
					b.body.position.y = 60 + Math.floor(i / 4) * 100
					b.scale = 1
					b.opacity = 1
				})
			}
			if (step === 'reveal') for (const b of bubbles) b.opacity = 0.8
			if (step === 'absorption') {
				for (const b of bubbles) b.opacity = 0
				const b = bubbles[0]
				vm.absorptionAnimator.startAbsorption(
					'still',
					b.artist.name,
					200,
					300,
					200,
					820,
					b.radius,
					200,
					null,
				)
				vm.absorptionAnimator.update(250)
			}
			if (step === 'direct') {
				vm.absorptionAnimator.update(10_000)
				for (const b of bubbles) b.opacity = 1
				// Without sprites the canvas draws every bubble directly.
				vm.sprites?.clear()
				vm.sprites?.stop()
			}
			// A first frame asks for the sprites of the new radii; draw again
			// once they are painted.
			vm.render()
			await wait(1500)
			if (step === 'direct') vm.sprites?.clear()
			vm.render()
			const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
			const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
			let bin = ''
			for (let i = 0; i < data.length; i += 0x8000) {
				bin += String.fromCharCode(...data.subarray(i, i + 0x8000))
			}
			return {
				width: canvas.width,
				height: canvas.height,
				rgba: btoa(bin),
				png: canvas.toDataURL('image/png'),
			}
		}, step)
	for (const step of STILLS) {
		const f = await draw(step)
		writeFileSync(
			join(dir, `${step}.rgba`),
			Buffer.concat([
				Buffer.from(new Uint32Array([f.width, f.height]).buffer),
				Buffer.from(f.rgba, 'base64'),
			]),
		)
		writeFileSync(
			join(dir, `${step}.png`),
			Buffer.from(f.png.replace(/^data:image\/png;base64,/, ''), 'base64'),
		)
	}
}

/** Per still frame: how far two builds' pixels are apart. */
function compareStills(a: string, b: string): void {
	const load = (dir: string, step: string) => {
		const buf = readFileSync(join(dir, `${step}.rgba`))
		return {
			width: buf.readUInt32LE(0),
			height: buf.readUInt32LE(4),
			px: buf.subarray(8),
		}
	}
	for (const step of STILLS) {
		const x = load(a, step)
		const y = load(b, step)
		if (x.width !== y.width || x.height !== y.height) {
			console.log(`${step}: sizes differ`)
			continue
		}
		let sum = 0
		let max = 0
		let over8 = 0
		let over32 = 0
		const n = x.px.length / 4
		for (let i = 0; i < x.px.length; i += 4) {
			let e = 0
			for (let c = 0; c < 4; c++)
				e = Math.max(e, Math.abs(x.px[i + c] - y.px[i + c]))
			sum += e
			if (e > max) max = e
			if (e > 8) over8++
			if (e > 32) over32++
		}
		console.log(
			`${step.padEnd(10)} mean ${(sum / n).toFixed(3)}/255  max ${max}  pixels > 8: ${((over8 / n) * 100).toFixed(3)}%  > 32: ${((over32 / n) * 100).toFixed(3)}%`,
		)
	}
}

function median(values: (number | null)[]): number | null {
	const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b)
	if (v.length === 0) return null
	const mid = Math.floor(v.length / 2)
	return v.length % 2 ? v[mid] : round1((v[mid - 1] + v[mid]) / 2)
}

async function main(): Promise<void> {
	if (args.compare) {
		const [a, b] = positionals
		if (!a || !b) throw new Error('--compare needs two --stills directories')
		compareStills(a, b)
		return
	}
	await stat(join(DIST, 'index.html')).catch(() => {
		throw new Error(`No build at ${DIST}; run npm run build first`)
	})
	const server = await serve(DIST)
	const { port } = server.address() as AddressInfo
	const browser = args.cdp
		? await chromium.connectOverCDP(args.cdp)
		: await chromium.launch()
	const results: NonNullable<Awaited<ReturnType<typeof round>>>[] = []
	try {
		for (let n = 0; n < RUNS; n++) {
			const r = await round(browser, port, n)
			if (!r) {
				console.log(`${LABEL}: still frames saved in ${args.stills}`)
				return
			}
			results.push(r)
			if (args.json) appendFileSync(args.json, `${JSON.stringify(r)}\n`)
			const { idle, tap } = r
			console.log(
				`${LABEL} #${r.round}  first-name ${r.marks['first-name']} ms | IDLE p50 ${idle.p50} p95 ${idle.p95} fps ${idle.fps} script p50 ${idle.scriptP50} rects ${idle.rectCalls} | TAP max ${tap.max} >50ms ${tap.over50} fps ${tap.fps} script p95 ${tap.scriptP95}${r.trace ? ` | idle layout/s ${r.trace.layoutPerSec} style/s ${r.trace.stylePerSec} paint/s ${r.trace.paintPerSec}` : ''}${r.errors.length ? ` | ${r.errors.length} console errors` : ''}`,
			)
		}
	} finally {
		if (!args.cdp) await browser.close()
		else await browser.close().catch(() => {})
		server.close()
	}
	const m = (pick: (r: (typeof results)[number]) => number | null) =>
		median(results.map(pick))
	console.log(
		`\n${LABEL}: medians over ${results.length} runs (GPU: ${results[0]?.gpu || 'unknown'})`,
	)
	console.log(
		`  idle   median interval ${m((r) => r.idle.p50)} ms (bound 17) | p95 interval ${m((r) => r.idle.p95)} ms (bound 34) | fps ${m((r) => r.idle.fps)} | script/frame p50 ${m((r) => r.idle.scriptP50)} ms`,
	)
	console.log(
		`  tap    longest frame ${m((r) => r.tap.max)} ms (bound 200) | frames > 50 ms ${m((r) => r.tap.over50)} (bound 5) | fps ${m((r) => r.tap.fps)}`,
	)
	if (results[0]?.trace) {
		console.log(
			`  idle trace  layout ${m((r) => r.trace?.layoutPerSec ?? null)}/s | style ${m((r) => r.trace?.stylePerSec ?? null)}/s | paint ${m((r) => r.trace?.paintPerSec ?? null)}/s`,
		)
	}
}

await main()
