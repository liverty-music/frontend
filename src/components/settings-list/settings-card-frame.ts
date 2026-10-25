/**
 * Story frame for the settings-*-row components: the rows only lay out inside
 * a `.settings-card` list (they are subgrid items of its icon | content |
 * control tracks), at a phone's content width (375 px screen, 16 px gutters).
 */
export function inSettingsCard(...rows: string[]): string {
	const items = rows
		.map((row) => `<li class="settings-list-item">${row}</li>`)
		.join('')
	return `<div style="inline-size: 343px; padding: 16px; background: var(--color-surface-base)"><ul class="settings-card" role="list">${items}</ul></div>`
}

/** Centre line of an element's box, for alignment assertions. */
export function centreY(el: Element): number {
	const box = el.getBoundingClientRect()
	return box.top + box.height / 2
}

/**
 * Leaves no hover or focus from a tap in the frame, so a screenshot taken
 * after an interaction shows the row at rest.
 */
export async function atRest(
	userEvent: { unhover: (el: Element) => Promise<void> },
	canvasElement: HTMLElement,
): Promise<void> {
	await userEvent.unhover(canvasElement)
	const focused = document.activeElement
	if (focused instanceof HTMLElement) focused.blur()
}
