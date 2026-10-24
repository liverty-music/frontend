import { readFileSync } from 'node:fs';

const DEFINITION = /(--color-[\w-]+)\s*:/g;

/**
 * The --color-* names the given stylesheets define, for the
 * `cube/no-undefined-color-token` option. Read by the stylelint config, so the
 * rule itself stays free of file access.
 */
export function definedColorTokens(...files) {
	const names = new Set();
	for (const file of files) {
		for (const m of readFileSync(file, 'utf8').matchAll(DEFINITION)) {
			names.add(m[1]);
		}
	}
	return [...names].sort();
}
