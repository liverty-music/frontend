const SATURATION = 70
const LIGHTNESS = 45

export function artistColor(name: string): string {
	let hash = 0
	for (const char of name) {
		hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
	}
	const hue = ((hash % 360) + 360) % 360
	return `hsl(${hue}, ${SATURATION}%, ${LIGHTNESS}%)`
}
