import { groth16 } from 'snarkjs'

export interface ProofRequest {
	wasmUrl: string
	zkeyUrl: string
	input: {
		trapdoor: string
		nullifierSecret: string
		merkleRoot: string
		pathElements: string[]
		pathIndices: number[]
	}
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

self.onmessage = async (event: MessageEvent<ProofRequest>) => {
	const { wasmUrl, zkeyUrl, input } = event.data

	try {
		self.postMessage({
			type: 'progress',
			stage: 'Generating proof...',
		} satisfies ProofProgress)

		const { proof, publicSignals } = await groth16.fullProve(
			input,
			wasmUrl,
			zkeyUrl,
		)

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
