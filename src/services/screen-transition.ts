import { IRouterEvents } from '@aurelia/router'
import { DI, type IDisposable, resolve } from 'aurelia'

export const IScreenTransition = DI.createInterface<IScreenTransition>(
	'IScreenTransition',
	(x) => x.singleton(ScreenTransition),
)

export interface IScreenTransition extends ScreenTransition {}

/**
 * How the screen changes, which picks its motion in `global.css`:
 * `tab` is a switch between the bottom navigation's tabs (the old route fades
 * out, then the new one fades in); `page` is any other change the fan makes
 * (opening a page from inside a page, going back).
 */
export type ScreenChange = 'tab' | 'page'

/**
 * The longest a `page` change waits for the router before it lets the old
 * screen go on showing: a route whose data load is slow must not freeze the
 * page while the browser holds the old snapshot.
 */
const PAGE_CHANGE_PATIENCE_MS = 1000

/**
 * Runs every screen change inside a View Transition and tells the stylesheet
 * which kind it is, on `:root[data-screen-change]`. The page header and the
 * navigation bar carry their own transition names, so they stay put
 * (`global.css`).
 *
 * A tab switch is started by the navigation bar through {@link switchTab}.
 * Every other navigation is picked up from the router's events, so a link, a
 * `router.load` and the browser's back button all move the same way without a
 * call site of their own. The first navigation (the app opening, at a deep
 * link or a redirect from `/`) is not animated. A navigation that another one
 * supersedes or redirects joins the transition already running instead of
 * starting a second one.
 */
export class ScreenTransition {
	private readonly routerEvents = resolve(IRouterEvents)

	private shown = false
	private running: { settle: () => void } | null = null
	private cancelTimer: ReturnType<typeof setTimeout> | undefined

	/** Start following the router. Dispose to stop (the shell's `unbinding`). */
	public watch(): IDisposable {
		const subscriptions = [
			this.routerEvents.subscribe('au:router:navigation-start', () =>
				this.navigationStarted(),
			),
			this.routerEvents.subscribe('au:router:navigation-end', () =>
				this.navigationEnded(),
			),
			this.routerEvents.subscribe('au:router:navigation-error', () =>
				this.navigationEnded(),
			),
			this.routerEvents.subscribe('au:router:navigation-cancel', () => {
				// A cancelled navigation is usually followed at once by the one that
				// replaced it; only when none follows does the transition end.
				this.cancelTimer = setTimeout(() => this.running?.settle(), 0)
			}),
		]
		return {
			dispose: () => {
				for (const subscription of subscriptions) subscription.dispose()
				clearTimeout(this.cancelTimer)
				this.running?.settle()
			},
		}
	}

	/**
	 * Run a tab switch: `load` changes the route; the returned promise settles
	 * once the transition's update callback has. `load` must not throw.
	 */
	public switchTab(load: () => Promise<void>): void {
		this.start('tab', load, () => {})
	}

	private navigationStarted(): void {
		clearTimeout(this.cancelTimer)
		if (!this.shown || this.running !== null) return
		let settle: () => void = () => {}
		const done = new Promise<void>((resolveUpdate) => {
			const patience = setTimeout(resolveUpdate, PAGE_CHANGE_PATIENCE_MS)
			settle = () => {
				clearTimeout(patience)
				resolveUpdate()
			}
		})
		this.start('page', () => done, settle)
	}

	private navigationEnded(): void {
		clearTimeout(this.cancelTimer)
		this.shown = true
		this.running?.settle()
	}

	/**
	 * Run `update` inside a View Transition of kind `change`. `settle` ends the
	 * wait inside `update`, if it has one; it is kept as `running` from the
	 * moment of the call, so a navigation that starts before the browser has
	 * called `update` joins this transition.
	 */
	private start(
		change: ScreenChange,
		update: () => Promise<void>,
		settle: () => void,
	): void {
		if (typeof document.startViewTransition !== 'function') {
			void update()
			return
		}
		const root = document.documentElement
		root.dataset.screenChange = change
		const mine = { settle }
		this.running = mine
		const transition = document.startViewTransition(update)
		void transition.ready.catch(() => {})
		void transition.finished
			.catch(() => {})
			.finally(() => {
				// A later transition replaces this one and owns the state by then.
				if (this.running !== mine) return
				this.running = null
				delete root.dataset.screenChange
			})
	}
}
