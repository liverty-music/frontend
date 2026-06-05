// SPDX-License-Identifier: MIT
//
// MIT License
//
// Copyright (c) 2026 Liverty Music
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// ============================================================================
// Independently-authored circom implementation of the optimized Poseidon
// permutation over BN254 (alpha = 5 S-box, R_F = 8 full rounds, R_P partial
// rounds). The round structure follows the optimized layout from Appendix B of
// the Poseidon paper (ePrint 2019/458): full rounds at the ends, a partial-
// round block in the middle whose constants are folded into POSEIDON_C, a
// single pre-sparse matrix POSEIDON_P at the full->partial transition, and a
// per-partial-round sparse matrix from POSEIDON_S. Constants come from the
// clean-room ./poseidon_constants.circom.
// ============================================================================

pragma circom 2.0.0;

include "./poseidon_constants.circom";

// Degree-5 S-box: out = in^5.
template Sigma() {
    signal input in;
    signal output out;

    signal in2;
    signal in4;

    in2 <== in * in;
    in4 <== in2 * in2;
    out <== in4 * in;
}

// Add-round-key: add the constant slice C[r .. r+t-1] to the state.
template Ark(t, C, r) {
    signal input in[t];
    signal output out[t];

    for (var i = 0; i < t; i++) {
        out[i] <== in[i] + C[i + r];
    }
}

// Full linear layer: out = M^T . in  (column i is the inner product of in with
// column i of the stored matrix M, i.e. lc += M[j][i] * in[j]).
template Mix(t, M) {
    signal input in[t];
    signal output out[t];

    var lc;
    for (var i = 0; i < t; i++) {
        lc = 0;
        for (var j = 0; j < t; j++) {
            lc += M[j][i] * in[j];
        }
        out[i] <== lc;
    }
}

// Single output column of the linear layer (used at the very end).
template MixLast(t, M, s) {
    signal input in[t];
    signal output out;

    var lc = 0;
    for (var j = 0; j < t; j++) {
        lc += M[j][s] * in[j];
    }
    out <== lc;
}

// Sparse linear layer for one partial round, using the flattened S array.
// Block r occupies (2t-1) entries: the first t form the first output row, the
// remaining t-1 form the first input column.
template MixS(t, S, r) {
    signal input in[t];
    signal output out[t];

    var lc = 0;
    for (var i = 0; i < t; i++) {
        lc += S[(t * 2 - 1) * r + i] * in[i];
    }
    out[0] <== lc;
    for (var i = 1; i < t; i++) {
        out[i] <== in[i] + in[0] * S[(t * 2 - 1) * r + t + i - 1];
    }
}

// Optimized Poseidon permutation with a configurable number of outputs.
template PoseidonEx(nInputs, nOuts) {
    signal input inputs[nInputs];
    signal input initialState;
    signal output out[nOuts];

    var N_ROUNDS_P[16] = [56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68];
    var t = nInputs + 1;
    var nRoundsF = 8;
    var nRoundsP = N_ROUNDS_P[t - 2];
    var C[t * nRoundsF + nRoundsP] = POSEIDON_C(t);
    var S[N_ROUNDS_P[t - 2] * (t * 2 - 1)] = POSEIDON_S(t);
    var M[t][t] = POSEIDON_M(t);
    var P[t][t] = POSEIDON_P(t);

    component ark[nRoundsF];
    component sigmaF[nRoundsF][t];
    component sigmaP[nRoundsP];
    component mix[nRoundsF - 1];
    component mixS[nRoundsP];
    component mixLast[nOuts];

    // Initial add-round-key over [initialState, inputs...].
    ark[0] = Ark(t, C, 0);
    for (var j = 0; j < t; j++) {
        if (j > 0) {
            ark[0].in[j] <== inputs[j - 1];
        } else {
            ark[0].in[j] <== initialState;
        }
    }

    // First R_F/2 - 1 full rounds: full S-box layer, add-round-key, full mix.
    for (var r = 0; r < nRoundsF \ 2 - 1; r++) {
        for (var j = 0; j < t; j++) {
            sigmaF[r][j] = Sigma();
            if (r == 0) {
                sigmaF[r][j].in <== ark[0].out[j];
            } else {
                sigmaF[r][j].in <== mix[r - 1].out[j];
            }
        }

        ark[r + 1] = Ark(t, C, (r + 1) * t);
        for (var j = 0; j < t; j++) {
            ark[r + 1].in[j] <== sigmaF[r][j].out;
        }

        mix[r] = Mix(t, M);
        for (var j = 0; j < t; j++) {
            mix[r].in[j] <== ark[r + 1].out[j];
        }
    }

    // Last full round of the first half, then the pre-sparse mix (matrix P).
    for (var j = 0; j < t; j++) {
        sigmaF[nRoundsF \ 2 - 1][j] = Sigma();
        sigmaF[nRoundsF \ 2 - 1][j].in <== mix[nRoundsF \ 2 - 2].out[j];
    }

    ark[nRoundsF \ 2] = Ark(t, C, (nRoundsF \ 2) * t);
    for (var j = 0; j < t; j++) {
        ark[nRoundsF \ 2].in[j] <== sigmaF[nRoundsF \ 2 - 1][j].out;
    }

    mix[nRoundsF \ 2 - 1] = Mix(t, P);
    for (var j = 0; j < t; j++) {
        mix[nRoundsF \ 2 - 1].in[j] <== ark[nRoundsF \ 2].out[j];
    }

    // Partial rounds: S-box on the first lane only, scalar add-round-key on the
    // first lane, sparse mix.
    for (var r = 0; r < nRoundsP; r++) {
        sigmaP[r] = Sigma();
        if (r == 0) {
            sigmaP[r].in <== mix[nRoundsF \ 2 - 1].out[0];
        } else {
            sigmaP[r].in <== mixS[r - 1].out[0];
        }

        mixS[r] = MixS(t, S, r);
        for (var j = 0; j < t; j++) {
            if (j == 0) {
                mixS[r].in[j] <== sigmaP[r].out + C[(nRoundsF \ 2 + 1) * t + r];
            } else {
                if (r == 0) {
                    mixS[r].in[j] <== mix[nRoundsF \ 2 - 1].out[j];
                } else {
                    mixS[r].in[j] <== mixS[r - 1].out[j];
                }
            }
        }
    }

    // Final R_F/2 - 1 full rounds.
    for (var r = 0; r < nRoundsF \ 2 - 1; r++) {
        for (var j = 0; j < t; j++) {
            sigmaF[nRoundsF \ 2 + r][j] = Sigma();
            if (r == 0) {
                sigmaF[nRoundsF \ 2 + r][j].in <== mixS[nRoundsP - 1].out[j];
            } else {
                sigmaF[nRoundsF \ 2 + r][j].in <== mix[nRoundsF \ 2 + r - 1].out[j];
            }
        }

        ark[nRoundsF \ 2 + r + 1] = Ark(t, C, (nRoundsF \ 2 + 1) * t + nRoundsP + r * t);
        for (var j = 0; j < t; j++) {
            ark[nRoundsF \ 2 + r + 1].in[j] <== sigmaF[nRoundsF \ 2 + r][j].out;
        }

        mix[nRoundsF \ 2 + r] = Mix(t, M);
        for (var j = 0; j < t; j++) {
            mix[nRoundsF \ 2 + r].in[j] <== ark[nRoundsF \ 2 + r + 1].out[j];
        }
    }

    // Last full round's S-box, then emit nOuts output lanes via MixLast.
    for (var j = 0; j < t; j++) {
        sigmaF[nRoundsF - 1][j] = Sigma();
        sigmaF[nRoundsF - 1][j].in <== mix[nRoundsF - 2].out[j];
    }

    for (var i = 0; i < nOuts; i++) {
        mixLast[i] = MixLast(t, M, i);
        for (var j = 0; j < t; j++) {
            mixLast[i].in[j] <== sigmaF[nRoundsF - 1][j].out;
        }
        out[i] <== mixLast[i].out;
    }
}

// Single-output Poseidon hash with capacity element fixed to 0.
template Poseidon(nInputs) {
    signal input inputs[nInputs];
    signal output out;

    component pEx = PoseidonEx(nInputs, 1);
    pEx.initialState <== 0;
    for (var i = 0; i < nInputs; i++) {
        pEx.inputs[i] <== inputs[i];
    }
    out <== pEx.out[0];
}
