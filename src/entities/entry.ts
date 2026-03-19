/**
 * Merkle path data needed for zero-knowledge entry proof generation.
 * @source proto/liverty_music/rpc/entry/v1/entry_service.proto — GetMerklePathResponse
 */
export interface MerklePath {
	readonly pathElements: Uint8Array[]
	readonly pathIndices: number[]
	readonly merkleRoot: Uint8Array
	readonly leaf: Uint8Array
}
