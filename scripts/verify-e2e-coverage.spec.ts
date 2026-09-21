import { describe, expect, it } from 'vitest'
import {
	checkE2eCoverage,
	type KnownGap,
	type ProjectRun,
} from './verify-e2e-coverage.lib'

const gap = (spec: string): KnownGap => ({ spec, reason: 'cannot run in CI' })
const run = (project: string, specs: string[]): ProjectRun => ({
	project,
	specs,
})

describe('checkE2eCoverage', () => {
	it('passes when every spec is executed', () => {
		const result = checkE2eCoverage(
			['e2e/a.spec.ts', 'e2e/b.spec.ts'],
			[run('functional', ['e2e/a.spec.ts', 'e2e/b.spec.ts'])],
			[],
		)

		expect(result).toEqual({ kind: 'ok', specs: 2, projects: 1, gaps: 0 })
	})

	it('passes when an unexecuted spec is a recorded gap', () => {
		const result = checkE2eCoverage(
			['e2e/a.spec.ts', 'e2e/b.spec.ts'],
			[run('functional', ['e2e/a.spec.ts'])],
			[gap('e2e/b.spec.ts')],
		)

		expect(result.kind).toBe('ok')
	})

	it('fails a spec no project runs and no gap records', () => {
		const result = checkE2eCoverage(
			['e2e/a.spec.ts', 'e2e/b.spec.ts'],
			[run('functional', ['e2e/a.spec.ts'])],
			[],
		)

		expect(result).toEqual({
			kind: 'failed',
			failures: [{ kind: 'uncovered-spec', spec: 'e2e/b.spec.ts' }],
		})
	})

	it('fails a project that matches nothing', () => {
		// The `pwa` bug: all three of its specs sat in `testIgnore`, so CI started
		// an empty project and counted it as a pass. An empty project also removes
		// nothing from the uncovered set, so a coverage diff ALONE reports success
		// here — which is why this is checked separately.
		const result = checkE2eCoverage(
			['e2e/a.spec.ts'],
			[run('functional', ['e2e/a.spec.ts']), run('pwa', [])],
			[],
		)

		expect(result).toEqual({
			kind: 'failed',
			failures: [{ kind: 'empty-project', project: 'pwa' }],
		})
	})

	it('fails a gap for a spec that is now executed', () => {
		// A gaps list nobody prunes stops describing reality and starts excusing
		// it — the state the stale "not available in CI headless" reason was in.
		const result = checkE2eCoverage(
			['e2e/a.spec.ts'],
			[run('pwa', ['e2e/a.spec.ts'])],
			[gap('e2e/a.spec.ts')],
		)

		expect(result).toEqual({
			kind: 'failed',
			failures: [
				{
					kind: 'stale-gap',
					spec: 'e2e/a.spec.ts',
					detail: 'spec is executed now — remove it from the gaps list',
				},
			],
		})
	})

	it('fails a gap for a spec that no longer exists', () => {
		const result = checkE2eCoverage(
			['e2e/a.spec.ts'],
			[run('functional', ['e2e/a.spec.ts'])],
			[gap('e2e/deleted.spec.ts')],
		)

		expect(result).toEqual({
			kind: 'failed',
			failures: [
				{
					kind: 'stale-gap',
					spec: 'e2e/deleted.spec.ts',
					detail: 'spec no longer exists — remove it from the gaps list',
				},
			],
		})
	})

	it('reports an empty project and an uncovered spec together', () => {
		// Both original defects at once: the project CI runs verifies nothing, and
		// the spec it was meant to cover is orphaned.
		const result = checkE2eCoverage(
			['e2e/a.spec.ts'],
			[run('pwa', [])],
			[],
		)

		expect(result.kind).toBe('failed')
		expect(result.kind === 'failed' && result.failures).toEqual([
			{ kind: 'empty-project', project: 'pwa' },
			{ kind: 'uncovered-spec', spec: 'e2e/a.spec.ts' },
		])
	})
})
