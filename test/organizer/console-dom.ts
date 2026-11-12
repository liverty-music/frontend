import { CustomElement } from 'aurelia'
import type { ConsoleField } from '../../organizer/ui/console-field/console-field'

/**
 * Helpers to read a rendered console screen in jsdom. The console's
 * components render into shadow roots, so a plain `querySelector` stops at
 * their host.
 */

/** Every element matching the selector, in the root and inside its shadow roots. */
export function deepAll<T extends Element = HTMLElement>(
	root: ParentNode,
	selector: string,
): T[] {
	const found: T[] = [...root.querySelectorAll<T>(selector)]
	const hosts = [...root.querySelectorAll('*')]
	if (root instanceof Element) hosts.unshift(root)
	for (const el of hosts) {
		if (el.shadowRoot) found.push(...deepAll<T>(el.shadowRoot, selector))
	}
	return found
}

/** The first element matching the selector, or null. */
export function deepOne<T extends Element = HTMLElement>(
	root: ParentNode,
	selector: string,
): T | null {
	return deepAll<T>(root, selector)[0] ?? null
}

/**
 * The text a member reads in the node: shadow roots included, a `<slot>`
 * replaced by the nodes assigned to it, and elements hidden from assistive
 * technology (`aria-hidden="true"`) left out.
 */
export function deepText(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
	if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== 11) return ''
	const el = node as Element
	if (el.getAttribute?.('aria-hidden') === 'true') return ''
	let kids: Node[]
	if (el instanceof HTMLSlotElement) {
		const assigned = el.assignedNodes({ flatten: true })
		kids = assigned.length ? assigned : [...el.childNodes]
	} else if (el.shadowRoot) kids = [...el.shadowRoot.childNodes]
	else kids = [...node.childNodes]
	return kids
		.map((kid) => deepText(kid))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * The button or link whose accessible name is exactly `name` (its text, or
 * its `aria-label`), in the root or its shadow roots.
 */
export function controlNamed(
	root: ParentNode,
	name: string,
): HTMLElement | null {
	return (
		deepAll(root, 'button, a, [role="menuitem"]').find(
			(el) => (el.getAttribute('aria-label') ?? deepText(el)) === name,
		) ?? null
	)
}

/**
 * jsdom implements neither the dialog's `showModal` / `close` nor the popover
 * API; model them so a dialog's open state and its close event can be read.
 * Returns the function that puts the originals back.
 */
export function installDialogAndPopover(): () => void {
	const dialog = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
	const original = { showModal: dialog.showModal, close: dialog.close }
	dialog.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '')
	}
	dialog.close = function (this: HTMLDialogElement) {
		if (!this.hasAttribute('open')) return
		this.removeAttribute('open')
		this.dispatchEvent(new Event('close'))
	}
	const html = HTMLElement.prototype as Partial<HTMLElement>
	const popover = { show: html.showPopover, hide: html.hidePopover }
	html.showPopover ??= () => {}
	html.hidePopover ??= () => {}
	return () => {
		dialog.showModal = original.showModal
		dialog.close = original.close
		html.showPopover = popover.show
		html.hidePopover = popover.hide
	}
}

/** The console field whose label contains `label`. */
export function fieldNamed(
	root: ParentNode,
	label: string | RegExp,
): ConsoleField | undefined {
	return deepAll(root, 'console-field')
		.map((el) => CustomElement.for<ConsoleField>(el).viewModel)
		.find((f) =>
			typeof label === 'string' ? f.label.includes(label) : label.test(f.label),
		)
}

/** Types into a console field as a member does: the value, then the committed change. */
export function fillField(
	root: ParentNode,
	label: string | RegExp,
	value: string,
): void {
	const field = fieldNamed(root, label)
	if (!field) throw new Error(`no field labelled ${label}`)
	field.input.value = value
	field.input.dispatchEvent(new Event('input', { bubbles: true }))
	field.input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** The dialogs that are open now, in the root and its shadow roots. */
export function openDialogs(root: ParentNode): HTMLDialogElement[] {
	return deepAll<HTMLDialogElement>(root, 'dialog').filter((d) =>
		d.hasAttribute('open'),
	)
}
