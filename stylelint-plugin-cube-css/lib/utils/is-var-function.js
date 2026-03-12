/**
 * Check if a CSS value string contains at least one var() reference.
 */
export function containsVar(value) {
	return /\bvar\s*\(/.test(value);
}

/**
 * Check if a CSS value string contains a calc() expression.
 */
export function containsCalc(value) {
	return /\bcalc\s*\(/.test(value);
}

/** Values that are inherently structural and bypass token enforcement. */
const STRUCTURAL_VALUES = new Set([
	'0',
	'auto',
	'none',
	'inherit',
	'initial',
	'unset',
	'revert',
	'revert-layer',
	'currentcolor',
	'transparent',
]);

/**
 * Check if a single token is a structural value that does not require var().
 */
function isStructuralToken(token) {
	if (STRUCTURAL_VALUES.has(token)) return true;

	// Grid fractions: 1fr, 2fr, etc.
	if (/^\d+fr$/.test(token)) return true;

	return false;
}

/**
 * Check if a value is a structural value that does not require var().
 * Handles single values and space-separated multi-value declarations
 * (e.g., "1fr 2fr", "auto none").
 * Each token in the value must be structural for the whole value to qualify.
 */
export function isStructuralValue(value) {
	const normalized = value.trim().toLowerCase();

	// Fast path: single token
	if (isStructuralToken(normalized)) return true;

	// Multi-value: split on whitespace and check each token
	const tokens = normalized.split(/\s+/);

	if (tokens.length > 1) {
		return tokens.every(isStructuralToken);
	}

	return false;
}
