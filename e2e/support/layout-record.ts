import fs from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

/**
 * Layout record for refactors that must not change what users see: with
 * `LAYOUT_DIR` set, every test that passes writes the box of each rendered
 * element (inside shadow roots too) to `<LAYOUT_DIR>/<project>--<test>.json`.
 * Record once before and once after the change, then compare the two folders
 * with `npm run compare-layout -- <before> <after>`.
 *
 * Web fonts are blocked while recording, so text widths do not depend on when
 * the font arrives. Without `LAYOUT_DIR` nothing changes.
 */

export const layoutDir = process.env.LAYOUT_DIR

/** Blocks web fonts, so both recordings draw text in the same fallback. */
export async function blockWebFonts(page: Page): Promise<void> {
	await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
}

/** Writes the boxes of the page's elements for this test. */
export async function recordLayout(
	page: Page,
	testInfo: TestInfo,
	dir: string,
): Promise<void> {
	// Let transitions and finite animations the last step started finish
	// (looping ones never do, so the wait is capped).
	await page.evaluate(async () => {
		const finite = document
			.getAnimations()
			.filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
		await Promise.race([
			Promise.allSettled(finite.map((a) => a.finished)),
			new Promise((resolve) => setTimeout(resolve, 2000)),
		])
	})
	const boxes = await page.evaluate(() => {
		const out: Record<string, number[]> = {}
		const visit = (root: ParentNode, prefix: string) => {
			const seen = new Map<string, number>()
			for (const el of Array.from(root.children)) {
				const classes = [...el.classList].filter((c) => !c.startsWith('au-'))
				const name = `${el.tagName.toLowerCase()}${classes.length ? `.${classes.join('.')}` : ''}`
				const n = seen.get(name) ?? 0
				seen.set(name, n + 1)
				const key = `${prefix}/${name}[${n}]`
				const r = el.getBoundingClientRect()
				if (r.width > 0 && r.height > 0) {
					out[key] = [r.x, r.y, r.width, r.height].map(
						(v) => Math.round(v * 2) / 2,
					)
				}
				visit(el, key)
				if (el.shadowRoot) visit(el.shadowRoot, `${key}#shadow`)
			}
		}
		visit(document, '')
		return out
	})
	const name = `${testInfo.project.name}--${testInfo.titlePath.join(' › ')}`
		.replace(/[^\w.-]+/g, '_')
		.slice(0, 200)
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(boxes))
}
