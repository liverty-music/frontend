import init, { prove } from '../../prover/pkg/ticketcheck_prover.js'
import proverWasmUrl from '../../prover/pkg/ticketcheck_prover_bg.wasm?url'

// Web Worker that generates the zk entry proof on-device so the private
// `trapdoor` never leaves the browser. Uses the MIT/Apache arkworks
// (`ark-circom`) WASM prover — no GPL `snarkjs`. The circuit artifacts are
// passed in as already-integrity-verified bytes (see proof-service.ts).

export interface ProofRequest {
	input: {
		trapdoor: string
		merkleRoot: string
		eventId: string
		pathElements: string[]
		pathIndices: number[]
	}
	wasmBytes: ArrayBuffer
	r1csBytes: ArrayBuffer
	zkeyBytes: ArrayBuffer
}

export interface ProofResult {
	type: 'success'
	proof: unknown
	publicSignals: string[]
}

export interface ProofError {
	type: 'error'
	message: string
}

export interface ProofProgress {
	type: 'progress'
	stage: string
}

export type ProofMessage = ProofResult | ProofError | ProofProgress

// Initialize the prover WASM module once per worker instance.
const ready = init(proverWasmUrl)

self.onmessage = async (event: MessageEvent<ProofRequest>) => {
	const { input, wasmBytes, r1csBytes, zkeyBytes } = event.data

	try {
		await ready

		self.postMessage({
			type: 'progress',
			stage: 'Generating proof...',
		} satisfies ProofProgress)

		// The prover emits snarkjs-format proof JSON (G2 limb order [c0, c1])
		// that the backend's circom2gnark -> gnark.Verify path accepts unchanged.
		const out = prove(
			JSON.stringify(input),
			new Uint8Array(wasmBytes),
			new Uint8Array(r1csBytes),
			new Uint8Array(zkeyBytes),
		)
		const { proof, publicSignals } = JSON.parse(out) as {
			proof: unknown
			publicSignals: string[]
		}

		self.postMessage({
			type: 'success',
			proof,
			publicSignals,
		} satisfies ProofResult)
	} catch (err) {
		self.postMessage({
			type: 'error',
			message: err instanceof Error ? err.message : String(err),
		} satisfies ProofError)
	}
}
