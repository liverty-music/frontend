import { beforeEach, describe, expect, it } from 'vitest'
import { StorageKeys } from '../constants/storage-keys'
import {
	type FabAction,
	FabMenuService,
	settingsAction,
} from './fab-menu-service'

function action(id: string, kind: FabAction['kind'] = 'command'): FabAction {
	return { id, labelKey: `label.${id}`, icon: id, kind, invoke: () => {} }
}

describe('FabMenuService', () => {
	let sut: FabMenuService

	beforeEach(() => {
		localStorage.clear()
		sut = new FabMenuService()
	})

	describe('register / dispose', () => {
		it('flattens contributed actions into the observable list', () => {
			sut.register({}, [action('a'), action('b')])
			expect(sut.actions.map((x) => x.id)).toEqual(['a', 'b'])
		})

		it('preserves owner insertion order across multiple owners', () => {
			sut.register({ n: 1 }, [action('a')])
			sut.register({ n: 2 }, [action('b'), action('c')])
			expect(sut.actions.map((x) => x.id)).toEqual(['a', 'b', 'c'])
		})

		it('removes an owner’s actions when its disposer is called', () => {
			const owner = {}
			const dispose = sut.register(owner, [action('a')])
			sut.register({}, [action('b')])
			dispose()
			expect(sut.actions.map((x) => x.id)).toEqual(['b'])
		})

		it('disposer is idempotent', () => {
			const dispose = sut.register({}, [action('a')])
			dispose()
			dispose()
			expect(sut.actions).toEqual([])
		})
	})

	describe('owner-keyed replace (no stale / no duplicate)', () => {
		it('re-registering the same owner replaces its set', () => {
			const owner = {}
			sut.register(owner, [action('a'), action('b')])
			// e.g. a dashboard mode switch re-registers a different set.
			sut.register(owner, [action('c')])
			expect(sut.actions.map((x) => x.id)).toEqual(['c'])
		})

		it('does not accumulate or duplicate after repeated re-registration', () => {
			const owner = {}
			sut.register(owner, [action('a')])
			sut.register(owner, [action('a')])
			sut.register(owner, [action('a')])
			expect(sut.actions.map((x) => x.id)).toEqual(['a'])
		})

		it('a navigated-away owner leaves no residual actions', () => {
			const routeA = {}
			const disposeA = sut.register(routeA, [action('a')])
			// Navigate away → dispose A, then route B registers.
			disposeA()
			sut.register({}, [action('b')])
			expect(sut.actions.map((x) => x.id)).toEqual(['b'])
		})
	})

	describe('trailing item', () => {
		it('comes after every route set', () => {
			sut.setTrailing(settingsAction(() => {}))
			sut.register({ n: 1 }, [action('a')])
			sut.register({ n: 2 }, [action('b')])
			expect(sut.actions.map((x) => x.id)).toEqual(['a', 'b', 'settings'])
		})

		it('stays last when a route re-registers its set', () => {
			const owner = {}
			sut.register(owner, [action('a')])
			sut.setTrailing(settingsAction(() => {}))
			sut.register(owner, [action('a'), action('b')])
			expect(sut.actions.map((x) => x.id)).toEqual(['a', 'b', 'settings'])
		})

		it('is the only item when no route contributes one', () => {
			sut.setTrailing(settingsAction(() => {}))
			expect(sut.actions.map((x) => x.id)).toEqual(['settings'])
		})

		it('is removed when cleared', () => {
			sut.register({}, [action('a')])
			sut.setTrailing(settingsAction(() => {}))
			sut.setTrailing(null)
			expect(sut.actions.map((x) => x.id)).toEqual(['a'])
		})

		it('settingsAction is a labelled command with the settings icon', () => {
			const invoke = () => {}
			expect(settingsAction(invoke)).toEqual({
				id: 'settings',
				labelKey: 'fabMenu.settings',
				icon: 'settings',
				kind: 'command',
				invoke,
			})
		})
	})

	describe('hide', () => {
		it('empties actions, and its disposer restores them', () => {
			// @spec components/infrastructure/fan/web/global/fab-menu "FAB hidden while the route hides the launcher"
			const owner = {}
			sut.register(owner, [action('a')])
			sut.setTrailing(settingsAction(() => {}))
			const show = sut.hide(owner)
			expect(sut.actions).toEqual([])
			show()
			expect(sut.actions.map((x) => x.id)).toEqual(['a', 'settings'])
		})

		it('keeps the launcher hidden while a route re-registers its set', () => {
			const owner = {}
			sut.hide(owner)
			sut.register(owner, [action('a')])
			expect(sut.actions).toEqual([])
		})

		it('disposer is idempotent', () => {
			const show = sut.hide({})
			const other = sut.hide({})
			show()
			show()
			expect(sut.actions).toEqual([])
			other()
			sut.register({}, [action('a')])
			expect(sut.actions.map((x) => x.id)).toEqual(['a'])
		})
	})

	describe('handedness', () => {
		it('defaults to right-handed', () => {
			expect(sut.handed).toBe('right')
			expect(sut.isLeftHanded).toBe(false)
		})

		it('toggles and persists the placement', () => {
			sut.toggleHanded()
			expect(sut.handed).toBe('left')
			expect(sut.isLeftHanded).toBe(true)
			expect(localStorage.getItem(StorageKeys.fabHanded)).toBe('left')
			sut.toggleHanded()
			expect(sut.handed).toBe('right')
			expect(localStorage.getItem(StorageKeys.fabHanded)).toBe('right')
		})

		it('hydrates the persisted placement on construction', () => {
			localStorage.setItem(StorageKeys.fabHanded, 'left')
			expect(new FabMenuService().handed).toBe('left')
		})
	})
})
