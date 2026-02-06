import { BrowserPlatform } from '@aurelia/platform-browser'
import { type IFixture, onFixtureCreated, setPlatform } from '@aurelia/testing'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll } from 'vitest'

const jsdom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
	url: 'http://localhost',
})

const { window } = jsdom
const {
	document,
	navigator,
	Node,
	HTMLElement,
	HTMLAnchorElement,
	CustomEvent,
} = window

// Fix for "document is not defined" or "window is not defined"
Object.assign(globalThis, {
	window,
	document,
	navigator,
	Node,
	HTMLElement,
	HTMLAnchorElement,
	CustomEvent,
})

// Sets up the Aurelia environment for testing
function bootstrapTextEnv() {
	const platform = new BrowserPlatform(
		window as unknown as Window & typeof globalThis,
	)
	setPlatform(platform)
	BrowserPlatform.set(globalThis, platform)
}

const fixtures: IFixture<object>[] = []
beforeAll(() => {
	bootstrapTextEnv()
	onFixtureCreated((fixture) => {
		fixtures.push(fixture)
	})
})

afterEach(() => {
	fixtures.forEach(async (f) => {
		try {
			await f.stop(true)
		} catch {
			// ignore
		}
	})
	fixtures.length = 0
})
