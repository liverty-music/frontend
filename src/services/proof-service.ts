import { DI, ILogger, resolve } from 'aurelia'
import type { ProofMessage, ProofRequest } from '../workers/proof.worker'
import { IEntryService } from './entry-service'

const CIRCUIT_BASE_URL =
	import.meta.env.VITE_CIRCUIT_BASE_URL ?? '/circuits/ticketcheck-v1'

// SHA-256 hashes of known-good circuit files for integrity verification.
// Recompute after each circuit rebuild: sha256sum build/ticketcheck_js/ticketcheck.wasm build/ticketcheck_final.zkey
const CIRCUIT_HASHES: Record<string, string> = {
	'ticketcheck.wasm':
		'08de2f44c53230cefcb7d5b4dda5ff829e6afd1fbc52666cb12464a00f5e2f03',
	'ticketcheck.zkey':
		'f6cadb4cdeee3c49a5b9b86ae9ac954ee68b52a97ed21f013ff023bfc444a25e',
}

export interface ProofOutput {
	proofJson: string
	publicSignalsJson: string
}

export const IProofService = DI.createInterface<IProofService>(
	'IProofService',
	(x) => x.singleton(ProofServiceClient),
)

export interface IProofService extends ProofServiceClient {}

export class ProofServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ProofService')
	private readonly entryService = resolve(IEntryService)

	public async generateEntryProof(
		eventId: string,
		userId: string,
		onProgress?: (stage: string) => void,
		signal?: AbortSignal,
	): Promise<ProofOutput> {
		const start = performance.now()

		onProgress?.('Fetching Merkle path...')

		const merklePath = await this.entryService.getMerklePath(
			eventId,
			signal,
		)

		const pathElements = merklePath.pathElements.map((bytes) =>
			bytesToDecimal(bytes),
		)
		const pathIndices = [...merklePath.pathIndices]
		const merkleRoot = bytesToDecimal(merklePath.merkleRoot)
		const leaf = bytesToDecimal(merklePath.leaf)

		onProgress?.('Starting proof generation...')

		const wasmUrl = `${CIRCUIT_BASE_URL}/ticketcheck.wasm`
		const zkeyUrl = `${CIRCUIT_BASE_URL}/ticketcheck.zkey`

		// Verify circuit file integrity before proof generation.
		await this.verifyCircuitIntegrity(wasmUrl, 'ticketcheck.wasm')
		await this.verifyCircuitIntegrity(zkeyUrl, 'ticketcheck.zkey')

		// Convert eventId to a field element for the circuit.
		// Use the same encoding as the backend: treat UUID bytes as big-endian integer.
		const eventIdField = uuidToFieldElement(eventId)

		const proofInput: ProofRequest = {
			wasmUrl,
			zkeyUrl,
			input: {
				trapdoor: leaf,
				merkleRoot,
				eventId: eventIdField,
				pathElements,
				pathIndices,
			},
		}

		try {
			const result = await this.runWorker(proofInput, onProgress, signal)
			const durationMs = Math.round(performance.now() - start)

			this.logger.info('proof generation complete', {
				eventId,
				durationMs,
			})

			return {
				proofJson: JSON.stringify(result.proof),
				publicSignalsJson: JSON.stringify(result.publicSignals),
			}
		} catch (err) {
			const durationMs = Math.round(performance.now() - start)
			this.logger.error('proof generation failed', { eventId, durationMs, err })
			throw err
		}
	}

	private async verifyCircuitIntegrity(
		url: string,
		filename: string,
	): Promise<void> {
		const expectedHash = CIRCUIT_HASHES[filename]
		if (!expectedHash) return // Skip verification if hash not configured

		const response = await fetch(url)
		if (!response.ok) throw new Error(`Failed to fetch circuit file: ${url}`)

		const buffer = await response.arrayBuffer()
		const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const hashHex = hashArray
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')

		if (hashHex !== expectedHash) {
			throw new Error(
				`Circuit file integrity check failed for ${filename}: expected ${expectedHash}, got ${hashHex}`,
			)
		}
	}

	private runWorker(
		request: ProofRequest,
		onProgress?: (stage: string) => void,
		signal?: AbortSignal,
	): Promise<{ proof: unknown; publicSignals: string[] }> {
		if (signal?.aborted) {
			return Promise.reject(
				new DOMException('Proof generation aborted', 'AbortError'),
			)
		}
		return new Promise((resolve, reject) => {
			const worker = new Worker(
				new URL('../workers/proof.worker.ts', import.meta.url),
				{ type: 'module' },
			)

			const cleanup = () => {
				signal?.removeEventListener('abort', onAbort)
				worker.terminate()
			}

			const onAbort = () => {
				cleanup()
				reject(new DOMException('Proof generation aborted', 'AbortError'))
			}

			if (signal) {
				signal.addEventListener('abort', onAbort)
			}

			worker.onmessage = (event: MessageEvent<ProofMessage>) => {
				const msg = event.data
				switch (msg.type) {
					case 'progress':
						onProgress?.(msg.stage)
						break
					case 'success':
						cleanup()
						resolve({ proof: msg.proof, publicSignals: msg.publicSignals })
						break
					case 'error':
						cleanup()
						reject(new Error(msg.message))
						break
				}
			}

			worker.onerror = (err) => {
				cleanup()
				reject(new Error(`Worker error: ${err.message}`))
			}

			worker.postMessage(request)
		})
	}
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = ''
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0')
	}
	return hex
}

function bytesToDecimal(bytes: Uint8Array): string {
	// Convert big-endian bytes to a decimal string without BigInt literals.
	// snarkjs circuit inputs are decimal strings.
	const hex = bytesToHex(bytes)
	if (hex === '') return '0'
	return BigInt(`0x${hex}`).toString(10)
}

function uuidToFieldElement(uuid: string): string {
	// Strip hyphens and convert UUID hex to a decimal field element.
	const hex = uuid.replace(/-/g, '')
	return BigInt(`0x${hex}`).toString(10)
}
