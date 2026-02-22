import { DI, ILogger, resolve } from 'aurelia'
import type { ProofMessage, ProofRequest } from '../workers/proof.worker'
import { IEntryService } from './entry-service'

const CIRCUIT_BASE_URL =
	import.meta.env.VITE_CIRCUIT_BASE_URL ?? '/circuits/ticketcheck-v1'

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
		onProgress?.('Fetching Merkle path...')

		const merklePath = await this.entryService.getMerklePath(
			eventId,
			userId,
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

		const proofInput: ProofRequest = {
			wasmUrl,
			zkeyUrl,
			input: {
				trapdoor: leaf,
				nullifierSecret: leaf,
				merkleRoot,
				pathElements,
				pathIndices,
			},
		}

		const result = await this.runWorker(proofInput, onProgress, signal)

		this.logger.info('Proof generated', {
			eventId,
			publicSignals: result.publicSignals,
		})

		return {
			proofJson: JSON.stringify(result.proof),
			publicSignalsJson: JSON.stringify(result.publicSignals),
		}
	}

	private runWorker(
		request: ProofRequest,
		onProgress?: (stage: string) => void,
		signal?: AbortSignal,
	): Promise<{ proof: unknown; publicSignals: string[] }> {
		return new Promise((resolve, reject) => {
			const worker = new Worker(
				new URL('../workers/proof.worker.ts', import.meta.url),
				{ type: 'module' },
			)

			const cleanup = () => {
				worker.terminate()
			}

			if (signal) {
				signal.addEventListener('abort', () => {
					cleanup()
					reject(new DOMException('Proof generation aborted', 'AbortError'))
				})
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
