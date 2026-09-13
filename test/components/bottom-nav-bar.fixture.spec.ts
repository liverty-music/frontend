import { I18N } from '@aurelia/i18n'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { describe, expect, it } from 'vitest'
import { BottomNavBar } from '../../src/components/bottom-nav-bar/bottom-nav-bar'
import { SvgIcon } from '../../src/components/svg-icon/svg-icon'
import {
	IPageHeaderState,
	PageHeaderState,
} from '../../src/services/page-header-state'
import { createMockI18n } from '../helpers/mock-i18n'

describe('BottomNavBar (fixture)', () => {
	function createNav(activePath = '') {
		// Real PageHeaderState seeded with the active path; the nav's highlight is
		// a pure function of it (no router / route-tree mock).
		const state = new PageHeaderState()
		state.confirm({ titleKey: '', morphTitle: false, activePath })

		return createFixture
			.html('<bottom-nav-bar></bottom-nav-bar>')
			.deps(
				BottomNavBar,
				SvgIcon,
				Registration.instance(IPageHeaderState, state),
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
