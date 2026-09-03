import { beforeEach, describe, expect, it } from 'vitest'
import { StorageKeys } from '../constants/storage-keys'
import { type FabAction, FabMenuService } from './fab-menu-service'

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
