import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/exception-data-attr.js';

const ruleName = 'cube/exception-data-attr';

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
	it('accepts selectors with [data-*] attribute in exception layer', async () => {
		const result = await lint(`
			@layer exception {
				.card[data-state="reversed"] { color: blue; }
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects selectors without [data-*] in exception layer', async () => {
		const result = await lint(`
			@layer exception {
				.card--reversed { color: blue; }
			}
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('.card--reversed');
		expect(warnings[0].text).toContain('[data-*]');
	});

	it('ignores selectors in non-exception layers', async () => {
		const result = await lint(`
			@layer block {
				.card { color: red; }
			}
			@layer utility {
				.flow > * + * { margin-top: 1rem; }
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('accepts bare [data-*] attribute selector in exception layer', async () => {
		const result = await lint(`
			@layer exception {
				[data-theme="dark"] .card { background: black; }
			}
		`);

		expect(getWarnings(result)).toHaveLength(0);
	});

	it('rejects class-only selector in exception layer', async () => {
		const result = await lint(`
			@layer exception {
				.is-active { display: block; }
			}
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('.is-active');
	});

	it('reports multiple violations in exception layer', async () => {
		const result = await lint(`
			@layer exception {
				.card--reversed { color: blue; }
				.button--disabled { opacity: 0.5; }
				.card[data-state="error"] { border-color: red; }
			}
		`);

		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
	});
});
