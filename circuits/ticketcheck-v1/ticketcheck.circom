pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";

// TicketCheck circuit for privacy-preserving event entry verification.
//
// Proves that the prover knows a secret (trapdoor) whose Poseidon hash
// is a leaf in the Merkle tree with the given root, and computes a
// nullifier hash to prevent double-entry.
//
// Private inputs:
//   trapdoor        - secret value; Poseidon(trapdoor) = identity commitment (leaf)
//   pathElements[]  - Merkle proof sibling hashes
//   pathIndices[]   - binary path indices (0 = left, 1 = right)
//
// Public inputs:
//   merkleRoot      - expected root of the identity commitment tree
//   eventId         - event identifier; binds the nullifier to a specific event
//   nullifierHash   - Poseidon(trapdoor, eventId); deterministic per user per event

template TicketCheck(depth) {
    // Private inputs
    signal input trapdoor;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Public inputs
    signal input merkleRoot;
    signal input eventId;
    signal input nullifierHash;

    // Step 1: Compute identity commitment = Poseidon(trapdoor)
    // This must match the backend's IdentityCommitment(userID) computation.
    component identityHasher = Poseidon(1);
    identityHasher.inputs[0] <== trapdoor;
    signal identityCommitment <== identityHasher.out;

    // Step 2: Compute nullifier hash = Poseidon(trapdoor, eventId)
    // Binding the nullifier to both the identity secret and the event ID ensures
    // it is deterministic per user per event, preventing double-entry bypass.
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== trapdoor;
    nullifierHasher.inputs[1] <== eventId;
    nullifierHash === nullifierHasher.out;

    // Step 3: Verify Merkle path from identityCommitment to merkleRoot.
    // At each level, hash the current node with the sibling, selecting
    // left/right placement based on pathIndices.
    component hashers[depth];
    signal currentHash[depth + 1];
    currentHash[0] <== identityCommitment;

    for (var i = 0; i < depth; i++) {
        // Constrain pathIndices to be binary (0 or 1).
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i] = Poseidon(2);

        // If pathIndices[i] == 0: current is left, sibling is right
        // If pathIndices[i] == 1: current is right, sibling is left
        hashers[i].inputs[0] <== currentHash[i] + pathIndices[i] * (pathElements[i] - currentHash[i]);
        hashers[i].inputs[1] <== pathElements[i] + pathIndices[i] * (currentHash[i] - pathElements[i]);

        currentHash[i + 1] <== hashers[i].out;
    }

    // Step 4: Constrain the computed root to equal the public merkleRoot.
    merkleRoot === currentHash[depth];
}

// Instantiate with depth 20 (supports up to 2^20 = ~1M attendees per event).
component main {public [merkleRoot, eventId, nullifierHash]} = TicketCheck(20);
