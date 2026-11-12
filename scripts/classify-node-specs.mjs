// Decides which unit spec files need no DOM and writes them to
// `test/node-environment-specs.json`, which `vitest.config.ts` reads to run
// those files in a Node environment instead of jsdom.
//
// A file qualifies when it passes with every unit spec run in Node
// (`CLASSIFY_NODE_SPECS=1`, read by `vitest.config.ts`). A spec that is not
// listed simply runs in jsdom, so nothing breaks when the list is stale; run
// this again to move newer specs over.
//
//   node scripts/classify-node-specs.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(tmpdir(), `classify-node-specs-${process.pid}.json`)

const run = spawnSync(
	'npx',
	[
		'vitest',
		'run',
		'--project=unit',
		'--reporter=json',
		`--outputFile=${out}`,
	],
	{
		cwd: root,
		stdio: ['ignore', 'inherit', 'inherit'],
		env: { ...process.env, CLASSIFY_NODE_SPECS: '1' },
	},
)
if (run.error) throw run.error

const report = JSON.parse(readFileSync(out, 'utf8'))
rmSync(out, { force: true })

// A file that picks its own environment with a docblock ignores the environment
// the run asks for, so its result says nothing about Node.
const pinned = /@vitest-environment\s+\S+/

const passing = report.testResults
	.filter((file) => file.status === 'passed' && file.assertionResults.length > 0)
	.map((file) => relative(root, file.name))
	.filter((file) => !pinned.test(readFileSync(join(root, file), 'utf8')))
	.sort()

writeFileSync(
	join(root, 'test/node-environment-specs.json'),
	`${JSON.stringify(passing, null, '\t')}\n`,
)
console.log(`${passing.length} of ${report.testResults.length} spec files run on Node`)
