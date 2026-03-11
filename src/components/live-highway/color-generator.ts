const SATURATION = 65
const LIGHTNESS = 60

export function artistHue(name: string): number {
	let hash = 0
	for (const char of name) {
		hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
	}
	return ((hash % 360) + 360) % 360
}

export function artistColor(name: string): string {
	return `hsl(${artistHue(name)}, ${SATURATION}%, ${LIGHTNESS}%)`
}
