declare module '*.html' {
	import { IContainer, PartialBindableDefinition } from 'aurelia'
	export const name: string
	export const template: string
	export default template
	export const dependencies: string[]
	export const containerless: boolean | undefined
	export const bindables: Record<string, PartialBindableDefinition>
	export const shadowOptions: { mode: 'open' | 'closed' } | undefined
	export function register(container: IContainer): void
}

// Vite-specific declarations for ?inline imports that return CSS as strings
declare module '*.css?inline' {
	const content: string
	export default content
}

declare module '*.css'

// The wasm-bindgen prover ships its own .d.ts (prover/pkg). The `?url` import
// of the prover wasm resolves to an asset URL string under Vite.
declare module '*.wasm?url' {
	const url: string
	export default url
}
