import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES = join(__dirname, '../../src/routes')

function routeStyles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return routeStyles(path)
		return /\.(css|html)$/.test(entry.name) ? [path] : []
	})
}

describe('route components and the navigation bar', () => {
	// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Pages do not compensate for navigation bar height"
	it('use no viewport-relative heights or bottom padding for the bar', () => {
		const offenders = routeStyles(ROUTES).filter((file) =>
			/\b100d?vh\b|\bpb-14\b/.test(readFileSync(file, 'utf8')),
		)
		expect(offenders).toEqual([])
	})
})
