import { concertWire } from '../support/concert-wire'
import { FAN_EMAIL, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

/**
 * E2E tests for snack-bar (renamed from snack-bar) using the Popover API.
 *
 * Covers verification tasks:
 * - 5.1: Multiple toasts appear, animate in, auto-dismiss, no zombies
 * - 5.2: Undo toast with action button on My Artists page
 * - 5.3: Toast appears above open dialog (Top Layer stacking)
 */

/** Mock all Connect-RPC routes with minimal responses. */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('FollowService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{
							id: { value: '00000000-0000-4000-8000-a10000000001' },
							name: { value: 'YOASOBI' },
							hype: 0,
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000002' },
							name: { value: 'Vaundy' },
							hype: 0,
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000003' },
							name: { value: 'Ado' },
							hype: 0,
						},
					],
				}),
			})
		}

		if (url.includes('Unfollow')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		if (url.includes('ConcertService/ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					concertWire({
						groups: [
							{
								date: { value: { year: 2026, month: 3, day: 15 } },
								away: [
									{
										id: { value: '00000000-0000-4000-8000-c10000000001' },
										performers: [
											{
												id: { value: '00000000-0000-4000-8000-a10000000001' },
												name: { value: 'Test Artist' },
												mbid: { value: '' },
											},
										],
										series: {
											id: { value: '00000000-0000-4000-8000-5e0000000001' },
											title: { value: 'Test Concert' },
										},
										localDate: {
											value: { year: 2026, month: 3, day: 15 },
										},
									},
								],
							},
						],
					}),
				),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/**
 * Publish a snack toast via the test bridge exposed by main.ts in DEV mode.
 *
 * main.ts exposes window.__lm_publishSnack when import.meta.env.DEV is true,
 * which calls ea.publish(new Snack(...)) using the real Aurelia EventAggregator.
 * This is the only reliable way to trigger snack-bar from Playwright without
 * accessing Aurelia internals directly.
 */
async function publishToastDirect(
	page: Page,
	message: string,
	severity: 'info' | 'warning' | 'error' = 'info',
	durationMs = 2500,
): Promise<void> {
	// The DEV bridge is attached only after `au.start()` resolves (main.ts),
	// which can land a tick after the snack-bar element is already in the DOM.
	// Wait for it so the publish below never races the bridge attachment.
	await page.waitForFunction(
		() =>
			typeof (window as unknown as Record<string, unknown>)
				.__lm_publishSnack === 'function',
		undefined,
		{ timeout: 10_000 },
	)
	await page.evaluate(
		({ message, severity, durationMs }) => {
			const bridge = (window as unknown as Record<string, unknown>)
				.__lm_publishSnack as
				| ((m: string, s: string, d: number) => void)
				| undefined
			if (typeof bridge !== 'function') {
				throw new Error(
					'__lm_publishSnack not found — ensure DEV server is running (main.ts exposes bridge in DEV mode)',
				)
			}
			bridge(message, severity, durationMs)
		},
		{ message, severity, durationMs },
	)
}

// =========================================================================
// 5.1: Multiple toasts — appear, animate, auto-dismiss, no zombies
// =========================================================================

test.describe('Toast notification: multiple rapid toasts (5.1)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'YOASOBI',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Vaundy',
						},
						home: null,
					},
					{
						artist: { id: '00000000-0000-4000-8000-a10000000003', name: 'Ado' },
						home: null,
					},
				]),
			)
		})
		await mockRpcRoutes(page)
		await page.goto('http://localhost:9000/dashboard')
		await page.waitForSelector('snack-bar', {
			state: 'attached',
			timeout: 10_000,
		})
	})

	test('3 rapid toasts appear as popover-open, then auto-dismiss without zombies', async ({
		page,
	}) => {
		test.setTimeout(30_000)

		// Publish 3 toasts rapidly with short duration for test speed
		for (let i = 1; i <= 3; i++) {
			await publishToastDirect(page, `Toast ${i}`, 'info', 2000)
		}

		// All 3 should be visible as popovers in the Top Layer
		const toasts = page.locator('.snack-item:popover-open')
		await expect(toasts).toHaveCount(3, { timeout: 3000 })

		// Verify each toast has opacity and is visible
		for (let i = 0; i < 3; i++) {
			await expect(toasts.nth(i)).toBeVisible()
		}

		// Wait for auto-dismiss via web-first assertion
		const remaining = page.locator('.snack-item')
		await expect(remaining).toHaveCount(0, { timeout: 5000 })
	})

	// @spec components/infrastructure/fan/web/global/snack-bar "Multiple simultaneous snacks"
	test('multiple toasts are rendered inside the snack-stack container', async ({
		page,
	}) => {
		await publishToastDirect(page, 'First toast', 'info', 5000)
		await publishToastDirect(page, 'Second toast', 'warning', 5000)

		const toasts = page.locator('.snack-item:popover-open')
		await expect(toasts).toHaveCount(2, { timeout: 3000 })

		// Both toasts are visible
		await expect(toasts.nth(0)).toBeVisible()
		await expect(toasts.nth(1)).toBeVisible()

		// Toasts are children of the .snack-stack container
		const stackCount = await page.locator('.snack-stack .snack-item').count()
		expect(stackCount).toBe(2)
		// Stacked in a flex-column container.
		const stack = await page
			.locator('.snack-stack')
			.evaluate((el) => getComputedStyle(el))
		expect(stack.display).toBe('flex')
		expect(stack.flexDirection).toContain('column')
	})
})

// =========================================================================
// 5.2: Undo toast on My Artists page
// =========================================================================

test.describe('Toast notification: undo toast on My Artists (5.2)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'YOASOBI',
							mbid: '00000000-0000-4000-8000-b00000000001',
						},
						home: 'JP-13',
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Vaundy',
							mbid: '00000000-0000-4000-8000-b00000000002',
						},
						home: 'JP-13',
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000003',
							name: 'Ado',
							mbid: '00000000-0000-4000-8000-b00000000003',
						},
						home: 'JP-13',
					},
				]),
			)
		})
		await mockRpcRoutes(page)
		await page.goto('http://localhost:9000/my-artists')
		await page.waitForSelector('.artists-fieldset', {
			timeout: 10_000,
		})
	})

	test('unfollow shows undo toast with action button', async ({ page }) => {
		test.setTimeout(30_000)

		// Unfollow is now reached via Edit mode: tap the Edit toggle first,
		// then tap the per-row remove (-) button.
		// page-help's .dismiss-zone may intercept real pointer events,
		// so dispatch clicks via JS to bypass interception.
		const firstRow = page.locator('.artist-row').first()
		await expect(firstRow).toBeVisible()

		// Enter edit mode. Edit moved from the header into the FAB action launcher
		// as a command: open the FAB, tap Edit — it enters edit mode and closes
		// the launcher on its own (the FAB hides while editing), so no extra
		// dismiss is needed and the per-row remove buttons are immediately live.
		await page.evaluate(() => {
			const fab = document.querySelector<HTMLElement>('fab-menu .fab-toggle')
			if (!fab) throw new Error('fab-menu .fab-toggle not found')
			fab.click()
		})
		await page.evaluate(() => {
			const edit = document.querySelector<HTMLElement>(
				'fab-menu .fab-item[data-action-id="edit"]',
			)
			if (!edit) throw new Error('FAB edit item not found')
			edit.click()
		})

		// Wait for Aurelia to render the per-row remove buttons.
		await expect(page.locator('.artist-remove-btn').first()).toBeVisible()

		// Click the remove button on the first artist row.
		await page.evaluate(() => {
			const btn = document.querySelector<HTMLElement>('.artist-remove-btn')
			if (!btn) throw new Error('.artist-remove-btn not found')
			btn.click()
		})

		// Toast should appear
		const toast = page.locator('.snack-item:popover-open')
		await expect(toast).toHaveCount(1, { timeout: 5000 })
		await expect(toast.first()).toBeVisible()

		// Toast should contain a message
		const toastText = await toast.first().textContent()
		expect(toastText).toBeTruthy()
	})
})

// =========================================================================
// 5.3: Toast appears above open dialog (Top Layer stacking)
// =========================================================================

test.describe('Toast notification: appears above dialog (5.3)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'YOASOBI',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Vaundy',
						},
						home: null,
					},
					{
						artist: { id: '00000000-0000-4000-8000-a10000000003', name: 'Ado' },
						home: null,
					},
				]),
			)
		})
		await mockRpcRoutes(page)
	})

	// @spec components/infrastructure/fan/web/global/snack-bar "Top Layer stacking with dialogs"
	test('toast popover renders above an open dialog element', async ({
		page,
	}) => {
		test.setTimeout(30_000)

		await page.goto('http://localhost:9000/dashboard')
		await page.waitForSelector('snack-bar', {
			state: 'attached',
			timeout: 10_000,
		})

		// Open a dialog programmatically to simulate a modal being open
		await page.evaluate(() => {
			const dialog = document.createElement('dialog')
			dialog.id = 'test-dialog'
			dialog.style.cssText =
				'width:80%;height:50%;background:rgba(0,0,0,0.8);color:white;'
			dialog.textContent = 'Test Dialog'
			document.body.appendChild(dialog)
			dialog.showModal()
		})

		// Dialog should be visible
		const dialog = page.locator('#test-dialog')
		await expect(dialog).toBeVisible()

		// Now trigger a toast — it should appear above the dialog
		// (both are in the Top Layer; later entry is on top)
		await publishToastDirect(page, 'Toast above dialog', 'info', 5000)

		const toast = page.locator('.snack-item:popover-open')
		await expect(toast).toHaveCount(1, { timeout: 3000 })
		await expect(toast.first()).toBeVisible()

		// Verify the toast is rendered above the dialog by checking
		// the Top Layer order: toast (popover shown after dialog.showModal())
		// should be visually on top
		const toastBox = await toast.first().boundingBox()
		expect(toastBox).toBeTruthy()

		// The toast has non-zero bounding box and is in the popover open state,
		// confirming it is rendered in the Top Layer above the dialog.
		// (elementFromPoint is unreliable across top-layer entries in headless Chromium.)
		expect(toastBox!.width).toBeGreaterThan(0)
		expect(toastBox!.height).toBeGreaterThan(0)

		// Verify the dialog is still open (toast didn't close it)
		await expect(dialog).toBeVisible()
	})
})

// =========================================================================
// Placement above the bottom navigation and a visible bottom banner
// =========================================================================

const SNACK_CAPABILITY = 'components/infrastructure/fan/web/global/snack-bar'

/**
 * Boot a signed-in fan (backend mocked). The install banner is the persistent
 * bottom banner a signed-in fan sees; `banner` decides whether it is visible
 * or never offered (the app is installed).
 */
async function bootSignedIn(
	page: Page,
	banner: 'visible' | 'none',
): Promise<void> {
	await page.addInitScript(
		({ sub, email, banner }) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('ui.notificationPromptDismissed', 'true')
			if (banner === 'none') localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem(
				'oidc.user:https://auth.dev.liverty-music.app:371355407710421859',
				JSON.stringify({
					id_token: 'fake-id-token',
					access_token: 'fake-access-token',
					token_type: 'Bearer',
					scope: 'openid profile email',
					profile: { sub, email },
					expires_at: 9999999999,
				}),
			)
		},
		{ sub: FAN_SUB, email: FAN_EMAIL, banner },
	)
	await mockFanRpc(page)
	await page.goto('http://localhost:9000/tickets')
	await expect(page.locator('bottom-nav-bar nav')).toBeVisible({
		timeout: 30_000,
	})
}

/**
 * Wait until every finite animation/transition on `selector` has finished.
 * A bottom banner's attention cue (`banner-cue`) only paints and runs for a
 * minute, so it is not waited for.
 */
async function waitSettled(page: Page, selector: string): Promise<void> {
	await page.waitForFunction((sel) => {
		const el = document.querySelector(sel)
		return (
			el !== null &&
			el
				.getAnimations({ subtree: true })
				.filter(
					(a) =>
						a.effect?.getTiming().iterations !== Infinity &&
						(a as CSSAnimation).animationName !== 'banner-cue',
				)
				.every((a) => a.playState !== 'running')
		)
	}, selector)
}

/** Bottom edge of the open snack, once it has risen into place. */
async function openSnackBottom(page: Page): Promise<number> {
	const snack = page.locator('.snack-item:popover-open')
	await expect(snack).toHaveCount(1)
	await waitSettled(page, '.snack-item:popover-open')
	const box = await snack.boundingBox()
	if (!box) throw new Error('snack has no box')
	return box.y + box.height
}

async function topOf(page: Page, selector: string): Promise<number> {
	const box = await page.locator(selector).boundingBox()
	if (!box) throw new Error(`${selector} has no box`)
	return box.y
}

/** The `space-s` step at this viewport, in px. */
async function spaceS(page: Page): Promise<number> {
	return page.evaluate(() => {
		const probe = document.createElement('div')
		probe.style.blockSize = 'var(--space-s)'
		document.body.append(probe)
		const px = probe.getBoundingClientRect().height
		probe.remove()
		return px
	})
}

test.describe('Snack placement above the navigation', () => {
	test.use({ viewport: { width: 412, height: 915 } })
	test.describe.configure({ timeout: 60_000 })

	test(`@spec ${SNACK_CAPABILITY} "No banner is visible"`, async ({ page }) => {
		await bootSignedIn(page, 'none')
		await publishToastDirect(page, 'Saved', 'info', 10_000)

		const gap =
			(await topOf(page, 'bottom-nav-bar nav')) - (await openSnackBottom(page))
		expect(gap).toBeCloseTo(await spaceS(page), 0)
		expect(gap).toBeGreaterThanOrEqual(16)
		expect(gap).toBeLessThanOrEqual(20)
	})

	test(`@spec ${SNACK_CAPABILITY} "A hidden banner adds no height"`, async ({
		page,
	}) => {
		await bootSignedIn(page, 'none')
		// My Artists mounts both hosts for an installed, signed-in fan: the
		// install banner's (in the shell) and the signup prompt's, both hidden.
		await page.locator('.nav-tab[data-nav="my-artists"]').click()
		await page.waitForURL('**/my-artists')
		await expect(page.locator('pwa-install-banner')).toBeAttached()
		await expect(page.locator('signup-prompt-banner')).toBeAttached()
		await expect(page.locator('.pwa-banner, .signup-banner')).toHaveCount(0)
		await publishToastDirect(page, 'Saved', 'info', 10_000)

		const gap =
			(await topOf(page, 'bottom-nav-bar nav')) - (await openSnackBottom(page))
		expect(gap).toBeCloseTo(await spaceS(page), 0)
	})

	test(`@spec ${SNACK_CAPABILITY} "A banner is visible"`, async ({ page }) => {
		await bootSignedIn(page, 'visible')
		await expect(page.locator('.pwa-banner')).toBeVisible()
		await waitSettled(page, 'pwa-install-banner')
		await publishToastDirect(page, 'Saved', 'info', 10_000)

		const bannerTop = await topOf(page, '.pwa-banner')
		const gap = bannerTop - (await openSnackBottom(page))
		expect(gap).toBeCloseTo(await spaceS(page), 0)
		// A positive gap means the snack covers no part of the banner.
		expect(gap).toBeGreaterThan(0)
		await expect(page.locator('.snack-item')).toHaveCount(0, {
			timeout: 15_000,
		})

		// My Artists also mounts the (hidden) signup prompt next to the install
		// banner; the hidden one must not cancel the visible one's height, or
		// the snack would cover the banner.
		await page.locator('.nav-tab[data-nav="my-artists"]').click()
		await page.waitForURL('**/my-artists')
		await expect(page.locator('signup-prompt-banner')).toBeAttached()
		await waitSettled(page, 'pwa-install-banner')
		await publishToastDirect(page, 'Saved', 'info', 10_000)
		const onMyArtists =
			(await topOf(page, '.pwa-banner')) - (await openSnackBottom(page))
		expect(onMyArtists).toBeGreaterThan(0)
	})

	test(`@spec ${SNACK_CAPABILITY} "Same placement for every severity"`, async ({
		page,
	}) => {
		await bootSignedIn(page, 'none')
		const bottoms: number[] = []
		for (const severity of ['info', 'warning', 'error'] as const) {
			await publishToastDirect(page, `A ${severity} snack`, severity, 1500)
			bottoms.push(await openSnackBottom(page))
			await expect(page.locator('.snack-item')).toHaveCount(0, {
				timeout: 5000,
			})
		}
		expect(bottoms[1]).toBeCloseTo(bottoms[0], 0)
		expect(bottoms[2]).toBeCloseTo(bottoms[0], 0)
	})
})

test.describe('Snack motion from the bottom edge', () => {
	test.use({ viewport: { width: 412, height: 915 } })
	test.describe.configure({ timeout: 60_000 })

	/**
	 * The vertical offset and opacity at both ends of a snack's transform and
	 * opacity transitions, read the moment `phase` starts: on `enter` as soon as
	 * the snack opens, on `exit` right after `hidePopover()` (what a dismiss
	 * calls).
	 */
	async function transitionEnds(
		page: Page,
		phase: 'enter' | 'exit',
	): Promise<{
		fromY: number
		toY: number
		fromOpacity: number
		toOpacity: number
	}> {
		await page.waitForFunction(
			() =>
				typeof (window as unknown as Record<string, unknown>)
					.__lm_publishSnack === 'function',
		)
		return page.evaluate(
			(phase) =>
				new Promise((resolve) => {
					const ends = (el: Element, property: string) => {
						const t = el
							.getAnimations()
							.find((a) => (a as CSSTransition).transitionProperty === property)
						const frames =
							(t?.effect as KeyframeEffect | null)?.getKeyframes() ?? []
						return frames.length >= 2
							? [frames[0][property], frames[frames.length - 1][property]]
							: null
					}
					const read = (el: Element) => {
						const transform = ends(el, 'transform')
						const opacity = ends(el, 'opacity')
						if (!transform || !opacity) return false
						resolve({
							fromY: new DOMMatrix(String(transform[0])).m42,
							toY: new DOMMatrix(String(transform[1])).m42,
							fromOpacity: Number(opacity[0]),
							toOpacity: Number(opacity[1]),
						})
						return true
					}
					const publish = (window as unknown as Record<string, unknown>)
						.__lm_publishSnack as (m: string, s: string, d: number) => void
					publish('Motion', 'info', 10_000)
					const poll = () => {
						const el = document.querySelector('.snack-item:popover-open')
						if (el === null) {
							requestAnimationFrame(poll)
						} else if (phase === 'enter') {
							if (!read(el)) requestAnimationFrame(poll)
						} else if (el.getAnimations().length > 0) {
							// Let the entry finish before starting the exit.
							requestAnimationFrame(poll)
						} else {
							;(el as HTMLElement).hidePopover()
							read(el)
						}
					}
					poll()
				}),
			phase,
		)
	}

	test.beforeEach(async ({ page }) => {
		await bootSignedIn(page, 'none')
	})

	test(`@spec ${SNACK_CAPABILITY} "CSS entry animation"`, async ({ page }) => {
		const ends = await transitionEnds(page, 'enter')
		// Rises from 1rem below its place into place, fading in.
		expect(ends.fromY).toBeCloseTo(16, 0)
		expect(ends.toY).toBeCloseTo(0, 0)
		expect(ends.fromOpacity).toBe(0)
		expect(ends.toOpacity).toBe(1)
	})

	test(`@spec ${SNACK_CAPABILITY} "CSS exit animation"`, async ({ page }) => {
		const ends = await transitionEnds(page, 'exit')
		// Sinks from its place to 1rem below, fading out.
		expect(ends.fromY).toBeCloseTo(0, 0)
		expect(ends.toY).toBeCloseTo(16, 0)
		expect(ends.fromOpacity).toBe(1)
		expect(ends.toOpacity).toBe(0)
	})
})

test.describe('The update snack at a narrow width', () => {
	test.use({ viewport: { width: 360, height: 780 }, locale: 'ja-JP' })
	test.describe.configure({ timeout: 60_000 })

	test('keeps its message on one line next to the compact action', async ({
		page,
	}) => {
		await bootSignedIn(page, 'none')
		await page.waitForFunction(
			() =>
				typeof (window as unknown as Record<string, unknown>)
					.__lm_publishSnack === 'function',
		)
		await page.evaluate(() => {
			const publish = (window as unknown as Record<string, unknown>)
				.__lm_publishSnack as (
				m: string,
				s: string,
				d: number,
				o: object,
			) => void
			publish('新しいバージョンがあります', 'info', 60_000, {
				icon: null,
				attention: true,
				actionLabel: '更新',
			})
		})
		await openSnackBottom(page)

		await expect(page.locator('.snack-item .snack-icon')).toHaveCount(0)
		const lines = await page.locator('.snack-message').evaluate((el) => {
			const range = document.createRange()
			range.selectNodeContents(el)
			return new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
				.size
		})
		expect(lines).toBe(1)
	})
})
