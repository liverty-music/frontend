/**
 * Asserts that every Playwright spec is either executed by CI or recorded as a
 * known gap — and that every project CI invokes actually runs something.
 *
 * This is the check that was missing when the `pwa` project ran ZERO specs
 * while CI reported it as passing. All three of its specs sat in `testIgnore`,
 * so `--project=pwa` matched nothing; an empty project and a passing project
 * are indistinguishable in a green run. The same shape hid the WebKit specs,
 * which `functional` excluded as "covered by webkit-repro / chromium-control"
 * while no job invoked either of those projects.
 *
 * Two failure modes, deliberately kept separate:
 *
 *   `empty-project`  — CI runs a project that matches no spec. Always a bug:
 *                      the project is either misconfigured or should be deleted.
 *   `uncovered-spec` — a spec no executed project matches, and which is not in
 *                      the known-gaps list. Either wire it up, or record it
 *                      with its reason and named control.
 *
 * And the one that keeps the list honest:
 *
 *   `stale-gap`      — a known-gap entry that is now covered, or names a spec
 *                      that no longer exists. A gaps list nobody prunes stops
 *                      describing reality and starts excusing it.
 *
 * Pure and dependency-free so it can be unit-tested; the entry point supplies
 * the real spec list and the real Playwright output.
 */

/** A spec deliberately not executed, with the reason it cannot be. */
export interface KnownGap {
	/** Spec path, relative to the frontend root. */
	spec: string
	/** Why CI cannot run it. Must name a capability the environment lacks. */
	reason: string
}

/** One project CI invokes, and the specs it matched. */
export interface ProjectRun {
	/** Project name as passed to `--project=`, or the config for a whole run. */
	project: string
	/** Spec paths the project matched, relative to the frontend root. */
	specs: string[]
}

export type CoverageFailure =
	| { kind: 'empty-project'; project: string }
	| { kind: 'uncovered-spec'; spec: string }
	| { kind: 'stale-gap'; spec: string; detail: string }

export type CoverageResult =
	| { kind: 'ok'; specs: number; projects: number; gaps: number }
	| { kind: 'failed'; failures: CoverageFailure[] }

export function checkE2eCoverage(
	allSpecs: string[],
	runs: ProjectRun[],
	knownGaps: KnownGap[],
): CoverageResult {
	const failures: CoverageFailure[] = []

	// A project matching nothing is the `pwa` bug. Check it first: it is the
	// one failure that a coverage diff alone would report as "all covered",
	// because an empty project removes nothing from the uncovered set.
	for (const run of runs) {
		if (run.specs.length === 0) {
			failures.push({ kind: 'empty-project', project: run.project })
		}
	}

	const executed = new Set(runs.flatMap((r) => r.specs))
	const gapSpecs = new Set(knownGaps.map((g) => g.spec))
	const present = new Set(allSpecs)

	for (const spec of allSpecs) {
		if (!executed.has(spec) && !gapSpecs.has(spec)) {
			failures.push({ kind: 'uncovered-spec', spec })
		}
	}

	for (const gap of knownGaps) {
		if (!present.has(gap.spec)) {
			failures.push({
				kind: 'stale-gap',
				spec: gap.spec,
				detail: 'spec no longer exists — remove it from the gaps list',
			})
		} else if (executed.has(gap.spec)) {
			failures.push({
				kind: 'stale-gap',
				spec: gap.spec,
				detail: 'spec is executed now — remove it from the gaps list',
			})
		}
	}

	if (failures.length > 0) {
		return { kind: 'failed', failures }
	}
	return {
		kind: 'ok',
		specs: allSpecs.length,
		projects: runs.length,
		gaps: knownGaps.length,
	}
}
