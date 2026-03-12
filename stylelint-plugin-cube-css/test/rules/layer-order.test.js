import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/layer-order.js';

const ruleName = 'cube/layer-order';

async function lint(code, config = true) {
	return stylelint.lint({
		code,
		config: {
			plugins: [plugin],
			rules: { [ruleName]: config },
		},
	});
}

function getWarnings(result) {
	return result.results[0].warnings.filter((w) => w.rule === ruleName);
}

describe(ruleName, () => {
	it('accepts correct @layer declaration order', async () => {
		const result = await lint(`
			@layer reset, global, composition, utility, block, exception;
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects incorrect @layer declaration order', async () => {
		const result = await lint(`
			@layer block, reset, global;
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('Unexpected @layer declaration order');
	});

	it('accepts a subset of layers in correct relative order', async () => {
		const result = await lint(`
			@layer reset, composition, exception;
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects unknown layer names in declaration', async () => {
		const result = await lint(`
			@layer reset, custom, block;
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('Unknown CUBE CSS layer "custom"');
	});

	it('accepts @layer blocks in correct order', async () => {
		const result = await lint(`
			@layer reset {
				* { margin: 0; }
			}
			@layer block {
				.card { color: red; }
			}
			@layer exception {
				.card[data-state="reversed"] { color: blue; }
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects @layer blocks in incorrect order', async () => {
		const result = await lint(`
			@layer block {
				.card { color: red; }
			}
			@layer reset {
				* { margin: 0; }
			}
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('"reset"');
		expect(warnings[0].text).toContain('"block"');
	});

	it('rejects unknown layer name in @layer block', async () => {
		const result = await lint(`
			@layer custom {
				.card { color: red; }
			}
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('Unknown CUBE CSS layer "custom"');
	});

	it('ignores nested @layer blocks inside a top-level @layer', async () => {
		const result = await lint(`
			@layer reset {
				@layer utility {
					.inner { color: red; }
				}
			}
			@layer block {
				.card { color: blue; }
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('still validates order for valid names when declaration contains an unknown name', async () => {
		const result = await lint(`
			@layer block, TYPO, reset;
		`);

		const warnings = getWarnings(result);

		// Should report both: unknown "TYPO" AND out-of-order declaration
		expect(warnings.length).toBeGreaterThanOrEqual(2);
		expect(warnings.some((w) => w.text.includes('Unknown CUBE CSS layer "TYPO"'))).toBe(true);
		expect(warnings.some((w) => w.text.includes('Unexpected @layer declaration order'))).toBe(true);
	});

	it('accepts duplicate @layer blocks (same layer appearing twice)', async () => {
		const result = await lint(`
			@layer block {
				.card { color: red; }
			}
			@layer block {
				.button { color: blue; }
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});
});
