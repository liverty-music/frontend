import { DI, ILogger, resolve } from 'aurelia'
import { IEntryRpcClient } from '../adapter/rpc/client/entry-client'
import { IAppConfig } from '../config/app-config'
import {
	bytesToDecimal,
	bytesToHex,
	uuidToFieldElement,
} from '../entities/entry'
import type { ProofMessage, ProofRequest } from '../workers/proof.worker'

// SHA-256 hashes of known-good circuit files for integrity verification.
// Recompute after each circuit rebuild:
//   cd circuits/ticketcheck-v1 && mkdir -p build && circom ticketcheck.circom --wasm --output build --prime bn128
//   sha256sum build/ticketcheck_js/ticketcheck.wasm public/circuits/ticketcheck-v1/ticketcheck.zkey
// The .wasm is recompiled from the in-repo MIT Poseidon (permissive sources); the
// .zkey is reused unchanged because the MIT Poseidon yields a byte-identical R1CS.
const CIRCUIT_HASHES: Record<string, string> = {
	'ticketcheck.wasm':
		'd37508e4bd50b857171922875c7d732379d82ad88e9d23641228e4d9020c7761',
	'ticketcheck.r1cs':
		'a8a5a293b869522b47b78fc4043007007945a5d26732379ae1e5fe6c2ba846f2',
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
	private readonly entryClient = resolve(IEntryRpcClient)
	// Empty string is the spec's "ZK circuits unavailable in this environment"
	// signal — see frontend-runtime-config "Empty-string circuitBaseUrl
	// disables ZK features" scenario. generateEntryProof() guards on it
	// and refuses to fetch.
	private readonly circuitBaseUrl: string = resolve(IAppConfig).circuitBaseUrl

	public async generateEntryProof(
		eventId: string,
		userId: string,
		onProgress?: (stage: string) => void,
		signal?: AbortSignal,
	): Promise<ProofOutput> {
		if (!this.circuitBaseUrl) {
			throw new Error(
				'ZK circuits unavailable in this environment (circuitBaseUrl is empty in /config.json)',
			)
		}

		const start = performance.now()

		onProgress?.('Fetching Merkle path...')

		const merklePath = await this.entryClient.getMerklePath(
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

		// Fetch and integrity-verify each circuit artifact, then hand the verified
		// bytes to the worker (transferred zero-copy). The arkworks prover needs
		// the witness-calculator wasm, the r1cs (constraint matrices), and the zkey.
		const [wasmBytes, r1csBytes, zkeyBytes] = await Promise.all([
			this.fetchVerifiedArtifact('ticketcheck.wasm'),
			this.fetchVerifiedArtifact('ticketcheck.r1cs'),
			this.fetchVerifiedArtifact('ticketcheck.zkey'),
		])

		// Convert eventId to a field element for the circuit.
		// Use the same encoding as the backend: treat UUID bytes as big-endian integer.
		const eventIdField = uuidToFieldElement(eventId)

		const proofInput: ProofRequest = {
			input: {
				trapdoor: leaf,
				merkleRoot,
				eventId: eventIdField,
				pathElements,
				pathIndices,
			},
			wasmBytes,
			r1csBytes,
			zkeyBytes,
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

	// Fetch a circuit artifact and verify its SHA-256 against the integrity
	// manifest before use. Returns the verified bytes for proof generation.
	private async fetchVerifiedArtifact(filename: string): Promise<ArrayBuffer> {
		const url = `${this.circuitBaseUrl}/${filename}`
		const response = await fetch(url)
		if (!response.ok) throw new Error(`Failed to fetch circuit file: ${url}`)

		const buffer = await response.arrayBuffer()

		const expectedHash = CIRCUIT_HASHES[filename]
		if (expectedHash) {
			const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
			const hashHex = bytesToHex(new Uint8Array(hashBuffer))
			if (hashHex !== expectedHash) {
				throw new Error(
					`Circuit file integrity check failed for ${filename}: expected ${expectedHash}, got ${hashHex}`,
				)
			}
		}

		return buffer
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

			// Transfer the artifact buffers zero-copy to the worker.
			worker.postMessage(request, [
				request.wasmBytes,
				request.r1csBytes,
				request.zkeyBytes,
			])
		})
	}
}
