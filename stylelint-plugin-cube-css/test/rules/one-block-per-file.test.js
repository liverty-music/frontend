import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/one-block-per-file.js';

const ruleName = 'cube/one-block-per-file';

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
	it('accepts a single @scope inside @layer', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					.card { color: red; }
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('rejects multiple @scope directives inside @layer blocks', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					.card { color: red; }
				}
				@scope (.hero) {
					.hero { color: blue; }
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('2 @scope directives');
	});

	it('rejects @scope directives across multiple @layer blocks', async () => {
		const result = await lint(`
			@layer block {
				@scope (.card) {
					.card { color: red; }
				}
			}
			@layer block {
				@scope (.hero) {
					.hero { color: blue; }
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('2 @scope directives');
	});

	it('ignores @scope directives in non-block layers', async () => {
		const result = await lint(`
			@layer composition {
				@scope (.layout) {
					:scope { display: grid; }
				}
				@scope (.sidebar) {
					:scope { display: flex; }
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('ignores files without @layer blocks', async () => {
		const result = await lint(`
			@scope (.card) {
				.card { color: red; }
			}
			@scope (.hero) {
				.hero { color: blue; }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('reports on each extra @scope when there are three', async () => {
		const result = await lint(`
			@layer block {
				@scope (.a) { .a { color: red; } }
				@scope (.b) { .b { color: blue; } }
				@scope (.c) { .c { color: green; } }
			}
		`);
		const warnings = getWarnings(result);

		// Reports on the 2nd and 3rd @scope
		expect(warnings).toHaveLength(2);
		expect(warnings[0].text).toContain('3 @scope directives');
	});
});
