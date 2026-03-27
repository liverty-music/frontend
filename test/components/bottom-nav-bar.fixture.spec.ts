import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { BottomNavBar } from '../../src/components/bottom-nav-bar/bottom-nav-bar'
import { SvgIcon } from '../../src/components/svg-icon/svg-icon'
import { createMockI18n } from '../helpers/mock-i18n'

describe('BottomNavBar (fixture)', () => {
	function createNav(currentPath = '') {
		const mockRouter = {
			load: vi.fn(),
			routeTree: {
				root: {
					children: [{ computeAbsolutePath: () => currentPath }],
				},
			},
		}

		return createFixture
			.html('<bottom-nav-bar></bottom-nav-bar>')
			.deps(
				BottomNavBar,
				SvgIcon,
				Registration.instance(IRouter, mockRouter),
				Registration.instance(I18N, createMockI18n()),
			)
			.build()
	}

	it('renders 5 nav tabs', async () => {
		const fixture = await createNav().started

		const tabs = fixture.getAllBy('.nav-tab')
		expect(tabs.length).toBe(5)
	})

	it('sets data-active=true on the matching tab', async () => {
		const fixture = await createNav('dashboard').started

		fixture.assertAttr('.nav-tab:first-child', 'data-active', 'true')
	})

	it('sets data-active=false on non-matching tabs', async () => {
		const fixture = await createNav('dashboard').started

		fixture.assertAttr('.nav-tab:nth-child(2)', 'data-active', 'false')
	})
})
