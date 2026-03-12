import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/prefer-vi-over-vw.js';

const ruleName = 'cube/prefer-vi-over-vw';

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
	it('rejects vw unit and suggests vi', async () => {
		const result = await lint(`
			@layer block {
				.hero { width: 100vw; }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('vw');
		expect(warnings[0].text).toContain('vi');
	});

	it('rejects svw, lvw, and dvw units', async () => {
		const result = await lint(`
			@layer block {
				.a { width: 50svw; }
				.b { width: 75lvw; }
				.c { width: 100dvw; }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(3);
		expect(warnings[0].text).toContain('svi');
		expect(warnings[1].text).toContain('lvi');
		expect(warnings[2].text).toContain('dvi');
	});

	it('accepts vi, vh, and other non-vw units', async () => {
		const result = await lint(`
			@layer block {
				.a { width: 100vi; }
				.b { height: 100vh; }
				.c { font-size: 1rem; }
				.d { width: 50%; }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('does not match "vw" inside words like "overview"', async () => {
		const result = await lint(`
			@layer block {
				.overview { color: red; }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('detects multiple vw units in a single value', async () => {
		const result = await lint(`
			@layer block {
				.a { width: calc(100vw - 50svw); }
			}
		`);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(2);
	});
});
