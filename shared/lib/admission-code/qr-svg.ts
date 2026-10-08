import { encodeQR } from '@paulmillr/qr'

/** Light modules around the code, as the QR specification asks (4 modules). */
const QUIET_ZONE = 4

/**
 * The modules of the QR code for an AdmissionCode text: alphanumeric mode
 * (Base45 is its character set), error correction level M.
 */
export function admissionQrModules(text: string): boolean[][] {
	return encodeQR(text, 'raw', {
		ecc: 'medium',
		encoding: 'alphanumeric',
		border: 0,
	})
}

/**
 * An SVG of the QR code: dark modules on a white background with a white
 * quiet zone, for the highest contrast whatever the page theme. One path, so
 * the browser draws it quickly on every 15-second rotation.
 */
export function admissionQrSvg(text: string): string {
	const modules = admissionQrModules(text)
	const size = modules.length + QUIET_ZONE * 2
	let path = ''
	modules.forEach((row, y) => {
		row.forEach((dark, x) => {
			if (dark) path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`
		})
	})
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
		`<rect width="${size}" height="${size}" fill="#fff"/>` +
		`<path d="${path}" fill="#000"/></svg>`
	)
}

/** The SVG as a `data:` URL for an `<img>` (allowed by the CSP's img-src). */
export function admissionQrDataUrl(text: string): string {
	return `data:image/svg+xml,${encodeURIComponent(admissionQrSvg(text))}`
}
