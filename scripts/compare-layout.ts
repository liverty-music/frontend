/**
 * Prints, for each test recorded in both folders, the elements whose box
 * moved or changed size (`e2e/support/layout-record.ts` explains recording).
 *
 *   npm run compare-layout -- <before-dir> <after-dir>
 *
 * Exits 1 when any test differs. Animation frames that the last step of a
 * test caught mid-way (a sheet opening, a scroll in progress) show up too;
 * re-run that test to tell them from a real change.
 */
import fs from 'node:fs'
import path from 'node:path'
import { compareLayouts, type LayoutRecord } from './compare-layout.lib'

const [beforeDir, afterDir] = process.argv.slice(2)
if (!beforeDir || !afterDir) {
	console.error('usage: compare-layout <before-dir> <after-dir>')
	process.exit(2)
}

const read = (dir: string, file: string): LayoutRecord =>
	JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))

let compared = 0
let differing = 0
for (const file of fs.readdirSync(beforeDir).sort()) {
	if (!fs.existsSync(path.join(afterDir, file))) continue
	compared++
	const shifts = compareLayouts(read(beforeDir, file), read(afterDir, file))
	if (shifts.length === 0) continue
	differing++
	console.log(`## ${file.replace(/\.json$/, '')}`)
	for (const { element, delta } of shifts) {
		console.log(
			`  ${element}  Δ[x ${delta[0]}, y ${delta[1]}, w ${delta[2]}, h ${delta[3]}]`,
		)
	}
}
console.log(`${compared} tests compared, ${differing} differ`)
process.exit(differing > 0 ? 1 : 0)
