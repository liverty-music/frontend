import { describe, expect, it } from 'vitest'
import filterHtml from '../../src/components/artist-filter-bar/artist-filter-bar.html?raw'
import cardHtml from '../../src/components/live-highway/event-card.html?raw'
import sheetHtml from '../../src/components/live-highway/event-detail-sheet.html?raw'
import sheetTs from '../../src/components/live-highway/event-detail-sheet.ts?raw'
import type { JourneyStatus } from '../../src/entities/concert'
import { JOURNEY_NAV_ORDER } from '../../src/entities/ticket-journey'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'

type Catalog = Record<string, unknown>

function lookup(catalog: Catalog, key: string): unknown {
	return key
		.split('.')
		.reduce<unknown>(
			(node, part) => (node as Catalog | undefined)?.[part],
			catalog,
		)
}

/** Every leaf key under `prefix`, as dotted paths. */
function leaves(node: unknown, prefix: string): string[] {
	if (typeof node !== 'object' || node === null) return [prefix]
	return Object.entries(node).flatMap(([k, v]) => leaves(v, `${prefix}.${k}`))
}

describe('event detail sheet copy', () => {
	// @spec components/infrastructure/fan/web/route/dashboard "Required i18n keys"
	it('defines every required eventDetail key in both locales', () => {
		const required = [
			'eventDetail.ariaLabel',
			'eventDetail.openStart',
			'eventDetail.openInGoogleMaps',
			'eventDetail.ticketSection',
			'eventDetail.notify.start',
			'eventDetail.notify.next',
			'eventDetail.notify.active',
			'eventDetail.viewOfficialInfo',
			'eventDetail.addToCalendar',
			...leaves(lookup(ja, 'eventDetail.pushLine'), 'eventDetail.pushLine'),
			...leaves(lookup(ja, 'eventDetail.outOfRange'), 'eventDetail.outOfRange'),
		]
		for (const key of required) {
			expect(lookup(ja, key), `ja ${key}`).toBeTypeOf('string')
			expect(lookup(en, key), `en ${key}`).toBeTypeOf('string')
		}
		expect(lookup(ja, 'eventDetail.viewOfficialInfo')).toBe(
			'公式サイトでチケットを見る',
		)
		expect(lookup(ja, 'eventDetail.ticketSection')).toBe('チケット')
		// The pushLine and outOfRange groups have the same keys in both locales.
		for (const group of ['eventDetail.pushLine', 'eventDetail.outOfRange']) {
			expect(leaves(lookup(en, group), group).sort()).toEqual(
				leaves(lookup(ja, group), group).sort(),
			)
		}
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Static labels are i18n-keyed"
	it('embeds no literal text in the sheet template', () => {
		// The component file is wrapped in <template>, and the row repeats an
		// inner <template>; a template keeps its children in `.content`, so walk
		// every one of them.
		const words: string[] = []
		const walk = (root: DocumentFragment): void => {
			const walker = document.createTreeWalker(
				root,
				NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
			)
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (node instanceof HTMLTemplateElement) {
					walk(node.content)
					continue
				}
				if (node.nodeType !== Node.TEXT_NODE) continue
				// A binding (`${...}`) is data, not literal copy: keep only the
				// text outside the bindings.
				const [head, ...rest] = (node.textContent ?? '').split('${')
				const literal = [
					head,
					...rest.map((part) => part.slice(part.indexOf('}') + 1)),
				].join(' ')
				words.push(...literal.split(/\s+/).filter(Boolean))
			}
		}
		const template = document.createElement('template')
		template.innerHTML = sheetHtml
		walk(template.content)
		// The walk reached the sheet's markup.
		expect(
			template.content.querySelector('template')?.content.childNodes.length,
		).toBeGreaterThan(0)
		expect(words).toEqual([])
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Journey status enum values are i18n-keyed"
	// @spec components/infrastructure/fan/web/route/dashboard "Adding a new TicketJourneyStatus value"
	it('has a label for every journey status in both locales', () => {
		const statuses: readonly JourneyStatus[] = JOURNEY_NAV_ORDER
		for (const status of statuses) {
			const key = `eventDetail.journeyStatus.${status}`
			expect(lookup(ja, key), `ja ${key}`).toBeTruthy()
			expect(lookup(en, key), `en ${key}`).toBeTruthy()
			expect(lookup(ja, key)).not.toBe(status)
		}
	})

	// @spec components/infrastructure/fan/web/route/dashboard "Single source of truth"
	it('inlines no per-status label, icon or hue in the surfaces that show a status', () => {
		const icons = ['📝', '💰', '🎟️', '💔', '👀']
		for (const [name, source] of Object.entries({
			sheetHtml,
			sheetTs,
			cardHtml,
			filterHtml,
		})) {
			for (const icon of icons) {
				expect(source, `${name} inlines ${icon}`).not.toContain(icon)
			}
			expect(source, `${name} inlines a status label key`).not.toMatch(
				/eventDetail\.journeyStatus\.(tracking|applied|unpaid|paid|lost)/,
			)
			expect(source, `${name} inlines a hue token`).not.toMatch(
				/--journey-hue-/,
			)
		}
	})
})
