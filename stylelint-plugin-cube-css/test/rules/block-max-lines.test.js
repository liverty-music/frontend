import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import plugin from '../../lib/rules/block-max-lines.js';

const ruleName = 'cube/block-max-lines';

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
	it('rejects @scope block exceeding max lines', async () => {
		// Generate a @scope block with many lines
		const declarations = Array.from(
			{ length: 90 },
			(_, i) => `\t\t\t\t--prop-${i}: value;`,
		).join('\n');
		const code = `@layer block {\n\t@scope (.card) {\n\t\t.card {\n${declarations}\n\t\t}\n\t}\n}`;

		const result = await lint(code);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('exceeding the maximum of 80 lines');
	});

	it('accepts @scope block under default max lines', async () => {
		const declarations = Array.from(
			{ length: 5 },
			(_, i) => `\t\t\t\t--prop-${i}: value;`,
		).join('\n');
		const code = `@layer block {\n\t@scope (.card) {\n\t\t.card {\n${declarations}\n\t\t}\n\t}\n}`;

		const result = await lint(code);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('supports custom max option', async () => {
		const declarations = Array.from(
			{ length: 12 },
			(_, i) => `\t\t\t\t--prop-${i}: value;`,
		).join('\n');
		const code = `@layer block {\n\t@scope (.card) {\n\t\t.card {\n${declarations}\n\t\t}\n\t}\n}`;

		const result = await lint(code, [true, { max: 10 }]);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('maximum of 10 lines');
	});

	it('ignores @scope blocks outside @layer', async () => {
		const declarations = Array.from(
			{ length: 90 },
			(_, i) => `\t\t--prop-${i}: value;`,
		).join('\n');
		const code = `@scope (.card) {\n\t.card {\n${declarations}\n\t}\n}`;

		const result = await lint(code);
		const warnings = getWarnings(result);

		expect(warnings).toHaveLength(0);
	});

	it('checks multiple @scope blocks independently', async () => {
		const shortDecls = Array.from(
			{ length: 3 },
			(_, i) => `\t\t\t\t--p-${i}: v;`,
		).join('\n');
		const longDecls = Array.from(
			{ length: 90 },
			(_, i) => `\t\t\t\t--p-${i}: v;`,
		).join('\n');
		const code = [
			'@layer block {',
			`\t@scope (.small) {\n\t\t.small {\n${shortDecls}\n\t\t}\n\t}`,
			`\t@scope (.big) {\n\t\t.big {\n${longDecls}\n\t\t}\n\t}`,
			'}',
		].join('\n');

		const result = await lint(code);
		const warnings = getWarnings(result);

		// Only the big block should trigger
		expect(warnings).toHaveLength(1);
		expect(warnings[0].text).toContain('exceeding the maximum of 80 lines');
	});
});
