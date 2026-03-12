import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/require-layer.js';

const ruleName = 'cube/require-layer';

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
	it('accepts style rules inside @layer', async () => {
		const result = await lint(`
			@layer block {
				.card { color: red; }
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects style rules outside @layer', async () => {
		const result = await lint(`
			.card { color: red; }
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('style rule');
	});

	it('accepts @layer declaration statements (no body)', async () => {
		const result = await lint(`
			@layer reset, global, composition, utility, block, exception;
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('accepts @property at top level', async () => {
		const result = await lint(`
			@property --my-color {
				syntax: "<color>";
				inherits: false;
				initial-value: red;
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects @keyframes outside @layer', async () => {
		const result = await lint(`
			@keyframes fadeIn {
				from { opacity: 0; }
				to { opacity: 1; }
			}
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('@keyframes');
	});

	it('accepts @keyframes inside @layer', async () => {
		const result = await lint(`
			@layer block {
				@keyframes fadeIn {
					from { opacity: 0; }
					to { opacity: 1; }
				}
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('accepts @font-face at top level', async () => {
		const result = await lint(`
			@font-face {
				font-family: "MyFont";
				src: url("myfont.woff2");
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects multiple unlayered style rules', async () => {
		const result = await lint(`
			.card { color: red; }
			.button { color: blue; }
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
	});

	it('does nothing when rule is disabled', async () => {
		const result = await lint(`.card { color: red; }`, [false]);

		expect(getWarnings(result)).toHaveLength(0);
	});
});
