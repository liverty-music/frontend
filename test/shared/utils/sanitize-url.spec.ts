import { describe, expect, it } from 'vitest'
import { sanitizeUrl } from '../../../shared/utils/sanitize-url'

describe('sanitizeUrl', () => {
	it('passes through http and https URLs unchanged', () => {
		expect(sanitizeUrl('http://example.com/a')).toBe('http://example.com/a')
		expect(sanitizeUrl('https://example.com/b?q=1')).toBe(
			'https://example.com/b?q=1',
		)
	})

	it('neutralises dangerous schemes to an empty string', () => {
		expect(sanitizeUrl('javascript:alert(1)')).toBe('')
		expect(sanitizeUrl('data:text/html,<script>1</script>')).toBe('')
		expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('')
		expect(sanitizeUrl('file:///etc/passwd')).toBe('')
	})

	it('returns empty for unparseable or absent input', () => {
		expect(sanitizeUrl('not a url')).toBe('')
		expect(sanitizeUrl('')).toBe('')
		expect(sanitizeUrl(undefined)).toBe('')
	})
})
