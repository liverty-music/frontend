import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Assertions that a screen rendered WITH its component styles, for checks that
 * run on a production bundle (`e2e/prod-build/`, `e2e/smoke/post-deploy.spec.ts`).
 *
 * The defect they target: the first `@layer` rule the browser reads fixes the
 * cascade order. When a CSS chunk shared between entries is linked before the
 * entry's own CSS and the HTML does not declare the order first, `block` ranks
 * below `reset`, whose `padding: 0` and friends then win over every component
 * (v1.89.0). The dev server and Storybook load CSS differently and cannot
 * show it.
 */

interface LayerReport {
	/** The first layer rule of the document, as written, with its sheet. */
	first: { statement: boolean; text: string; sheet: string } | null
	/** Layer names the first rule declares, when it is a statement. */
	declared: string[]
	/** Layers used anywhere that the first statement does not declare. */
	undeclared: Array<{ name: string; sheet: string }>
}

/** Walk every same-origin stylesheet in document order and report its layers. */
export async function cascadeLayerReport(page: Page): Promise<LayerReport> {
	return page.evaluate(() => {
		const sheetName = (s: CSSStyleSheet) =>
			s.href ? new URL(s.href).pathname : '<style> in the document'
		const used: Array<{ name: string; sheet: string }> = []
		let first: LayerReport['first'] = null
		let declared: string[] = []

		const visit = (rules: CSSRuleList, sheet: string) => {
			for (const rule of Array.from(rules)) {
				if (rule instanceof CSSLayerStatementRule) {
					if (!first) {
						first = { statement: true, text: rule.cssText, sheet }
						declared = [...rule.nameList]
					}
					for (const name of rule.nameList) used.push({ name, sheet })
				} else if (rule instanceof CSSLayerBlockRule) {
					if (!first) {
						first = {
							statement: false,
							text: `@layer ${rule.name} { … }`,
							sheet,
						}
					}
					// An anonymous layer block has an empty name; it is not ordered
					// by name and cannot be declared up front.
					if (rule.name) used.push({ name: rule.name, sheet })
				}
				// Layers nested in @media / @supports / @scope still count.
				if ('cssRules' in rule && !(rule instanceof CSSLayerBlockRule)) {
					visit((rule as CSSGroupingRule).cssRules, sheet)
				}
			}
		}

		for (const sheet of Array.from(document.styleSheets)) {
			let rules: CSSRuleList
			try {
				rules = sheet.cssRules
			} catch {
				// Cross-origin sheets (web fonts) are unreadable and hold no layers.
				continue
			}
			visit(rules, sheetName(sheet))
		}

		const declaredSet = new Set(declared)
		const undeclared = used.filter((u) => !declaredSet.has(u.name))
		return { first, declared, undeclared }
	})
}

/**
 * The cascade layer order is declared before any layer is used: the first
 * layer rule of the document is a statement, and it names every layer any
 * stylesheet uses. Otherwise the order depends on which chunk loads first.
 */
export async function expectLayerOrderDeclaredFirst(page: Page): Promise<void> {
	const report = await cascadeLayerReport(page)
	expect
		.soft(
			report.first,
			'The document uses no cascade layer at all — its stylesheets did not load.',
		)
		.not.toBeNull()
	if (!report.first) return
	expect
		.soft(
			report.first.statement,
			`The first cascade layer rule of the document is \`${report.first.text}\` in ${report.first.sheet}, not an \`@layer a, b, …;\` statement. The cascade order is then fixed by whichever CSS chunk loads first, so component (\`block\`) styles can rank below \`reset\`. Declare the order in a <style> before any stylesheet in the entry HTML (see index.html).`,
		)
		.toBe(true)
	// Without a leading statement every layer is undeclared; the line above
	// already says why.
	if (!report.first.statement) return
	expect
		.soft(
			[...new Set(report.undeclared.map((u) => `${u.name} (${u.sheet})`))],
			`Layers used but not declared by the first layer statement (${report.declared.join(', ')}); their order depends on load order.`,
		)
		.toEqual([])
}

export interface StyleExpectation {
	/** Non-zero padding on some side (the reset layer sets it to 0). */
	padding?: boolean
	/** A background color or image (the reset or the browser leaves none). */
	background?: boolean
}

/**
 * The element carries its component's own styles. `what` names it in the
 * failure message, e.g. "the welcome page's primary button".
 */
export async function expectOwnStyles(
	locator: Locator,
	what: string,
	expected: StyleExpectation,
): Promise<void> {
	await expect(locator, `${what} is not visible`).toBeVisible()
	const style = await locator.evaluate((el) => {
		const cs = getComputedStyle(el)
		return {
			padding: [
				cs.paddingTop,
				cs.paddingRight,
				cs.paddingBottom,
				cs.paddingLeft,
			].map((v) => Number.parseFloat(v) || 0),
			backgroundColor: cs.backgroundColor,
			backgroundImage: cs.backgroundImage,
		}
	})
	if (expected.padding) {
		expect
			.soft(
				Math.max(...style.padding),
				`${what} has no padding (computed ${style.padding.join('px ')}px): its component styles are not applied.`,
			)
			.toBeGreaterThan(0)
	}
	if (expected.background) {
		const transparent =
			style.backgroundImage === 'none' &&
			/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor)
		expect
			.soft(
				transparent,
				`${what} has a transparent background (background-color ${style.backgroundColor}, background-image ${style.backgroundImage}): its component styles are not applied.`,
			)
			.toBe(false)
	}
}
