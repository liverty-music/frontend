import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../src')

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return sources(path)
		return /\.(ts|html)$/.test(entry.name) &&
			!/\.(spec|stories)\.ts$/.test(entry.name)
			? [path]
			: []
	})
}

describe('where push is offered', () => {
	// @spec components/infrastructure/fan/web/global/notification-prompt "No offer on other screens"
	it('only My Artists, the event detail sheet and the post-signup sheet use the push offer', () => {
		const callers = sources(SRC)
			.filter((file) =>
				/notification-prompt-service/.test(readFileSync(file, 'utf8')),
			)
			.map((file) => relative(SRC, file))
			.filter((file) => file !== 'services/notification-prompt-service.ts')
			.sort()

		expect(callers).toEqual([
			'components/concert-sheet/concert-sheet.ts',
			'components/post-signup-dialog/post-signup-dialog.ts',
			'routes/my-artists/my-artists-route.ts',
		])
	})
})
