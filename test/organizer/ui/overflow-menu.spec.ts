import { DI, INode, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type MenuItem,
	OverflowMenu,
} from '../../../organizer/ui/overflow-menu/overflow-menu'

/**
 * The menu's keyboard and choice handling (jsdom has no popover API, so the
 * popover's show and hide are stubbed; the rendered menu is covered by its
 * stories).
 */

const ITEMS: MenuItem[] = [
	{ id: 'cancel', labelKey: 'event.cancel', disabled: true },
	{ id: 'publish', labelKey: 'event.publish' },
	{ id: 'edit', labelKey: 'event.editConcert', href: '/edit' },
]

function setup() {
	const host = document.createElement('overflow-menu')
	const root = host.attachShadow({ mode: 'open' })
	const button = document.createElement('button')
	const menu = document.createElement('div')
	for (const item of ITEMS) {
		const el = document.createElement('button')
		el.setAttribute('role', 'menuitem')
		el.textContent = item.id
		if (item.disabled) el.setAttribute('aria-disabled', 'true')
		menu.append(el)
	}
	root.append(button, menu)
	document.body.append(host)

	let open = true
	menu.hidePopover = vi.fn(() => {
		open = false
	})
	const matches = menu.matches.bind(menu)
	menu.matches = (selector: string) =>
		selector === ':popover-open' ? open : matches(selector)

	const container = DI.createContainer()
	container.register(Registration.instance(INode, host))
	const component = container.invoke(OverflowMenu)
	component.items = ITEMS
	component.button = button
	component.menu = menu
	const items = [...menu.children] as HTMLElement[]
	const focused = () => root.activeElement?.textContent
	const key = (k: string) =>
		component.onKeydown(new KeyboardEvent('keydown', { key: k }))
	return { host, button, menu, component, items, focused, key }
}

describe('OverflowMenu', () => {
	beforeEach(() => {
		document.body.innerHTML = ''
	})

	it('focuses the first item that can be chosen when it opens', () => {
		const { component, focused } = setup()
		component.onToggle(Object.assign(new Event('toggle'), { newState: 'open' }))
		expect(component.open).toBe(true)
		expect(focused()).toBe('publish')

		component.onToggle(
			Object.assign(new Event('toggle'), { newState: 'closed' }),
		)
		expect(component.open).toBe(false)
	})

	it('moves between items with the arrow keys, Home and End', () => {
		const { items, focused, key } = setup()
		items[1].focus()
		expect(key('ArrowDown')).toBe(false)
		expect(focused()).toBe('edit')
		key('ArrowDown')
		expect(focused()).toBe('cancel')
		key('ArrowUp')
		expect(focused()).toBe('edit')
		key('Home')
		expect(focused()).toBe('cancel')
		key('End')
		expect(focused()).toBe('edit')
		// Other keys keep their default.
		expect(key('a')).toBe(true)
	})

	it('closes on Escape and on Tab, Escape returning focus to its button', () => {
		const { menu, button, key, items } = setup()
		items[1].focus()
		expect(key('Escape')).toBe(false)
		expect(menu.hidePopover).toHaveBeenCalledTimes(1)
		expect((button.getRootNode() as ShadowRoot).activeElement).toBe(button)

		expect(key('Tab')).toBe(true)
		expect(menu.hidePopover).toHaveBeenCalledTimes(2)
	})

	it('dispatches the chosen action and closes', () => {
		const { component, host, menu } = setup()
		const chosen: string[] = []
		host.addEventListener('select', (e) =>
			chosen.push((e as CustomEvent<string>).detail),
		)
		const event = new Event('click')
		expect(component.choose(ITEMS[1], event)).toBe(false)
		expect(chosen).toEqual(['publish'])
		expect(menu.hidePopover).toHaveBeenCalled()
	})

	it('lets a link item navigate, and ignores a disabled item', () => {
		const { component, host } = setup()
		const chosen: string[] = []
		host.addEventListener('select', (e) =>
			chosen.push((e as CustomEvent<string>).detail),
		)
		expect(component.choose(ITEMS[2], new Event('click'))).toBe(true)

		const click = new Event('click', { cancelable: true })
		expect(component.choose(ITEMS[0], click)).toBe(false)
		expect(click.defaultPrevented).toBe(true)
		expect(chosen).toEqual([])
	})
})
