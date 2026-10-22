import { describe, expect, it } from 'vitest'
import css from '../../src/routes/welcome/welcome-route.css?raw'
import html from '../../src/routes/welcome/welcome-route.html?raw'

/** The welcome template, parsed (bindings stay as attributes). */
function welcomeTemplate(): DocumentFragment {
	const t = document.createElement('template')
	t.innerHTML = html
	return t.content
}

describe('Welcome "can\'t sign in" link', () => {
	it('sits directly below every [Log In] CTA as a native link', () => {
		// @spec components/infrastructure/fan/web/route/welcome "Link below Log In"
		const logins = welcomeTemplate().querySelectorAll(
			'[data-testid="welcome-login"]',
		)
		// Screen 2 (demo footer) and the Screen 1 fallback.
		expect(logins).toHaveLength(2)
		for (const login of logins) {
			const link = login.nextElementSibling
			expect(link?.tagName).toBe('A')
			expect(link?.getAttribute('href')).toBe('/passkey-recovery')
			expect(link?.getAttribute('t')).toBe('welcome.cta.cantSignIn')
		}
	})

	it('gives the link a tap target of at least 44px', () => {
		const rule = css.slice(css.indexOf('.welcome-help-link {'))
		expect(rule.slice(0, rule.indexOf('}'))).toContain('min-block-size: 44px')
	})
})
