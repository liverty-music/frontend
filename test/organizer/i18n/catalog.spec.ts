import { describe, expect, it } from 'vitest'
import en from '../../../organizer/locales/en/translation.json'
import ja from '../../../organizer/locales/ja/translation.json'

/**
 * Every text a console template shows comes from the catalog, in Japanese and
 * in English. A template may hold interpolations, `t` bindings and symbols, but
 * no words of its own.
 */

const templates = import.meta.glob<string>('/organizer/**/*.html', {
	query: '?raw',
	import: 'default',
	eager: true,
})

/** Attributes whose value a person reads. */
const READABLE_ATTRIBUTES = [
	'aria-label',
	'aria-description',
	'placeholder',
	'title',
	'alt',
	'label',
]

/** The text with every `${…}` interpolation removed, nested braces included. */
function withoutInterpolations(text: string): string {
	let out = ''
	let depth = 0
	for (let i = 0; i < text.length; i++) {
		if (depth === 0 && text[i] === '$' && text[i + 1] === '{') {
			depth = 1
			i++
			continue
		}
		if (depth > 0) {
			if (text[i] === '{') depth++
			else if (text[i] === '}') depth--
			continue
		}
		out += text[i]
	}
	return out
}

/** Letters left once interpolations are removed: words, not symbols. */
function literalWords(text: string): string {
	return withoutInterpolations(text)
		.replace(/&[a-z]+;/g, '')
		.replace(/[^\p{L}]+/gu, ' ')
		.trim()
}

function literalsIn(html: string): string[] {
	const doc = new DOMParser().parseFromString(
		`<template>${html}</template>`,
		'text/html',
	)
	const root = doc.querySelector('template')?.content
	if (!root) return []
	const found: string[] = []

	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const parent = node.parentElement?.tagName.toLowerCase()
		if (parent === 'style' || parent === 'script') continue
		const words = literalWords(node.textContent ?? '')
		if (words) found.push(words)
	}

	for (const el of root.querySelectorAll('*')) {
		for (const name of READABLE_ATTRIBUTES) {
			const value = el.getAttribute(name)
			if (value === null) continue
			const words = literalWords(value)
			if (words) found.push(`${name}="${value}"`)
		}
	}
	return found
}

/** Dotted keys of a nested catalog. */
function keys(catalog: object, prefix = ''): string[] {
	return Object.entries(catalog).flatMap(([k, v]) =>
		v !== null && typeof v === 'object'
			? keys(v, `${prefix}${k}.`)
			: [`${prefix}${k}`],
	)
}

describe('console catalog', () => {
	it('templates show only catalog text', () => {
		const offenders = Object.entries(templates)
			.map(([file, html]) => ({ file, literals: literalsIn(html) }))
			.filter((t) => t.literals.length > 0)
		expect(offenders).toEqual([])
	})

	it('finds a literal word in a template', () => {
		expect(literalsIn('<button>Save</button>')).toEqual(['Save'])
		expect(literalsIn('<input placeholder="例: 渋谷">')).toEqual([
			'placeholder="例: 渋谷"',
		])
		expect(literalsIn("<p>${'common.save' & t} · ${count}</p>")).toEqual([])
		expect(literalsIn("<p>${'x' & t:{ n: $index + 1 }}</p>")).toEqual([])
		expect(literalsIn('<span t="common.save"></span>')).toEqual([])
	})

	it('has the same keys in Japanese and English', () => {
		expect(keys(en).sort()).toEqual(keys(ja).sort())
	})
})
