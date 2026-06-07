import { bindable, customAttribute, ILogger, INode, resolve } from 'aurelia'

/**
 * Marks a control busy while the bound click handler's promise is in flight and
 * guards against double-activation. While busy the element gets a `data-busy`
 * attribute (styled globally with a spinner + dim) and `aria-busy="true"`.
 *
 * The element's `disabled` property is intentionally never touched so this can
 * compose with an existing `disabled.bind` (e.g. a success state).
 *
 * Usage: <button busy-on-click.bind="() => handleLogin()">…</button>
 */
@customAttribute('busy-on-click')
export class BusyOnClickCustomAttribute {
	@bindable() public value: (() => unknown) | null = null

	private readonly element = resolve(INode) as HTMLElement
	private readonly logger = resolve(ILogger).scopeTo('BusyOnClick')
	private busy = false

	private readonly onClick = async (e: Event): Promise<void> => {
		if (this.busy) {
			e.preventDefault()
			e.stopImmediatePropagation()
			return
		}

		const result = this.value?.()
		// Sync / no-op handlers (e.g. a ternary returning undefined) skip the
		// busy state entirely and behave like a plain click.
		if (
			!result ||
			typeof (result as PromiseLike<unknown>).then !== 'function'
		) {
			return
		}

		this.busy = true
		this.element.setAttribute('data-busy', '')
		this.element.setAttribute('aria-busy', 'true')
		try {
			await result
		} catch (err) {
			this.logger.warn('busy-on-click handler rejected', { error: err })
		} finally {
			this.busy = false
			this.element.removeAttribute('data-busy')
			this.element.removeAttribute('aria-busy')
		}
	}

	public attached(): void {
		this.element.addEventListener('click', this.onClick)
	}

	public detaching(): void {
		this.element.removeEventListener('click', this.onClick)
	}
}
