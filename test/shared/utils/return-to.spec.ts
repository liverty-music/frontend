import { afterEach, describe, expect, it } from 'vitest'
import { currentInAppLocation } from '../../../shared/utils/return-to'

describe('currentInAppLocation', () => {
	afterEach(() => {
		window.history.pushState({}, '', '/')
	})

	it('returns the current path + query for a normal in-app route', () => {
		window.history.pushState({}, '', '/organizers?selected=abc')
		expect(currentInAppLocation()).toBe('/organizers?selected=abc')
	})

	it('returns undefined on the OIDC callback route (a transient target)', () => {
		window.history.pushState({}, '', '/auth/callback?code=x')
		expect(currentInAppLocation()).toBeUndefined()
	})

	it('returns undefined on the landing page (default destination)', () => {
		window.history.pushState({}, '', '/welcome')
		expect(currentInAppLocation()).toBeUndefined()
	})

	it('returns undefined on the root', () => {
		window.history.pushState({}, '', '/')
		expect(currentInAppLocation()).toBeUndefined()
	})
})
