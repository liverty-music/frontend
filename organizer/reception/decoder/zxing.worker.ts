/// <reference lib="webworker" />
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import type { DecodeReply, DecodeRequest } from './qr-decoder'

/**
 * The ZXing WebAssembly decoder, off the main thread. The `.wasm` is served
 * from this app's own origin (bundled by Vite), never from the package's
 * default CDN, so it falls under the organizer CSP's `'self'` and
 * `'wasm-unsafe-eval'`.
 */
prepareZXingModule({
	overrides: {
		locateFile: (path: string, prefix: string) =>
			path.endsWith('.wasm') ? wasmUrl : prefix + path,
	},
})

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.addEventListener('message', async (e: MessageEvent<DecodeRequest>) => {
	const { id, width, height, data } = e.data
	let reply: DecodeReply
	try {
		const results = await readBarcodes(new ImageData(data, width, height), {
			formats: ['QRCode'],
			tryHarder: true,
			maxNumberOfSymbols: 1,
		})
		reply = {
			id,
			texts: results.filter((r) => r.isValid && r.text).map((r) => r.text),
		}
	} catch (err) {
		reply = { id, error: err instanceof Error ? err.message : String(err) }
	}
	scope.postMessage(reply)
})
