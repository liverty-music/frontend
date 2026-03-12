import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/require-container-name.js';

const ruleName = 'cube/require-container-name';

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
	it('rejects container-type without container-name', async () => {
		const result = await lint(`
			@layer block {
				.card {
					container-type: inline-size;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('container-name');
	});

	it('accepts container-type with container-name sibling', async () => {
		const result = await lint(`
			@layer block {
				.card {
					container-name: card;
					container-type: inline-size;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('accepts container shorthand instead of separate declarations', async () => {
		const result = await lint(`
			@layer block {
				.card {
					container: card / inline-size;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('skips container-type: normal (reset value)', async () => {
		const result = await lint(`
			@layer block {
				.card {
					container-type: normal;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('rejects container-type when container-name is only in nested rule', async () => {
		const result = await lint(`
			.card {
				container-type: inline-size;
				.inner { container-name: card; }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('container-name');
	});

	it('accepts container-type when container shorthand is also present', async () => {
		const result = await lint(`
			@layer block {
				.sidebar {
					container: sidebar / size;
					container-type: inline-size;
				}
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});
});
