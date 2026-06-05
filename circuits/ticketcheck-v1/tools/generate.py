#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
#
# MIT License
#
# Copyright (c) 2026 Liverty Music
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#
# ============================================================================
# Clean-room regeneration of the Poseidon-BN254 round constants and MDS /
# sparse matrices used by circom's Poseidon permutation, for circuit widths
# t = 2 and t = 3 (alpha = 5 S-box, R_F = 8 full rounds, R_P = 56 / 57
# partial rounds).
#
# This file is an INDEPENDENT implementation written from the PUBLIC academic
# references; it does NOT copy any GPL-licensed source. The two algorithms it
# implements are:
#
#   1. The Grain LFSR parameter generator specified by the Poseidon authors in
#      "POSEIDON: A New Hash Function for Zero-Knowledge Proof Systems"
#      (Grassi, Khovratovich, Rechberger, Roy, Schofnegger; USENIX Security
#      2021, ePrint 2019/458), and described operationally in the reference
#      script `generate_parameters_grain.sage` from the IAIK `hadeshash`
#      repository. It produces the raw round constants and the (Cauchy) MDS
#      matrix.
#
#   2. The "sparse MDS" round-optimization of Appendix B of the same paper,
#      which folds the partial-round constants through the MDS matrix to obtain
#      the optimized constant vector C, the single pre-sparse matrix P, and the
#      per-partial-round sparse matrices S. The decomposition M = M' * M''
#      (where M'' is sparse) is the standard one also implemented by other
#      independent libraries (e.g. filecoin's `neptune`, `poseidon-rs`).
#
# All arithmetic is exact integer arithmetic modulo the BN254 scalar field p.
# Standard library only.
# ============================================================================

import sys

# BN254 (alt_bn128) scalar field modulus.
P = 0x30644E72E131A029B85045B68181585D2833E84879B9709143E1F593F0000001
N_BITS = 254  # field size in bits, as fed to the grain seeding

# Per circomlib: R_F = 8 full rounds for all widths; R_P depends on t.
R_F = 8
# Partial-round counts indexed by t-2 (only t=2,3 are exercised here).
N_ROUNDS_P = [56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68]


# ---------------------------------------------------------------------------
# Modular linear algebra helpers (exact, mod P)
# ---------------------------------------------------------------------------
def inv(a):
    return pow(a % P, P - 2, P)


def mat_mul(a, b):
    n = len(a)
    m = len(b[0])
    k = len(b)
    out = [[0] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            s = 0
            for t in range(k):
                s += a[i][t] * b[t][j]
            out[i][j] = s % P
        # keep reduced
    return out


def mat_vec(a, v):
    n = len(a)
    k = len(v)
    out = [0] * n
    for i in range(n):
        s = 0
        for j in range(k):
            s += a[i][j] * v[j]
        out[i] = s % P
    return out


def mat_inverse(m):
    """Gauss-Jordan inverse over GF(P)."""
    n = len(m)
    a = [[m[i][j] % P for j in range(n)] + [1 if i == j else 0 for j in range(n)]
         for i in range(n)]
    for col in range(n):
        # find pivot
        piv = None
        for r in range(col, n):
            if a[r][col] % P != 0:
                piv = r
                break
        if piv is None:
            raise ValueError("singular matrix")
        a[col], a[piv] = a[piv], a[col]
        pinv = inv(a[col][col])
        for j in range(2 * n):
            a[col][j] = (a[col][j] * pinv) % P
        for r in range(n):
            if r == col:
                continue
            f = a[r][col]
            if f == 0:
                continue
            for j in range(2 * n):
                a[r][j] = (a[r][j] - f * a[col][j]) % P
    return [[a[i][n + j] for j in range(n)] for i in range(n)]


def mat_transpose(m):
    n = len(m)
    k = len(m[0])
    return [[m[i][j] for i in range(n)] for j in range(k)]


# ---------------------------------------------------------------------------
# Grain LFSR (Poseidon paper, Appendix / hadeshash generate_parameters_grain)
# ---------------------------------------------------------------------------
class Grain:
    """80-bit Grain LFSR as specified by the Poseidon parameter generator.

    Seeding (80 bits, MSB first):
      b0..b1   : field flag           (2 bits)  -> 1 for prime field
      b2..b5   : S-box flag           (4 bits)  -> 0 for x^alpha (exponent sbox)
      b6..b17  : field size in bits   (12 bits)
      b18..b29 : number of rounds t   (12 bits)
      b30..b39 : full rounds R_F      (10 bits)
      b40..b49 : partial rounds R_P   (10 bits)
      b50..b79 : all ones             (30 bits)
    Then 160 bits are discarded (the LFSR is clocked 160 times) before output.
    """

    def __init__(self, field, sbox, n, t, r_f, r_p):
        state = []

        def append_bits(value, width):
            for i in range(width - 1, -1, -1):
                state.append((value >> i) & 1)

        append_bits(field, 2)
        append_bits(sbox, 4)
        append_bits(n, 12)
        append_bits(t, 12)
        append_bits(r_f, 10)
        append_bits(r_p, 10)
        append_bits((1 << 30) - 1, 30)
        assert len(state) == 80
        self.state = state
        # Discard the first 160 bits.
        for _ in range(160):
            self._next_bit()

    def _next_bit(self):
        s = self.state
        # Feedback per Grain: b80 = b62 ^ b51 ^ b38 ^ b23 ^ b13 ^ b0
        new = s[62] ^ s[51] ^ s[38] ^ s[23] ^ s[13] ^ s[0]
        s.pop(0)
        s.append(new)
        return new

    def next_bit(self):
        # Self-shrinking generator: take pairs (b0, b1); if b0==1 output b1,
        # else discard the pair and try again.
        while True:
            b0 = self._next_bit()
            b1 = self._next_bit()
            if b0 == 1:
                return b1
            # else discard

    def next_bits_int(self, num_bits):
        """Read num_bits bits MSB-first into an integer (no rejection)."""
        acc = 0
        for _ in range(num_bits):
            acc = (acc << 1) | self.next_bit()
        return acc

    def next_fp(self):
        """Draw one round-constant field element: read N_BITS bits, reject if
        >= P (rejection sampling, per generate_constants)."""
        while True:
            acc = self.next_bits_int(N_BITS)
            if acc < P:
                return acc


def grain_constants(t, r_f, r_p):
    """Generate the raw round constants (length t*(r_f+r_p)) and MDS matrix.

    Parameters fed to the LFSR: field=1 (prime), sbox=0 (exponent x^alpha).
    """
    grain = Grain(1, 0, N_BITS, t, r_f, r_p)

    n_round_constants = t * (r_f + r_p)
    round_constants = [grain.next_fp() for _ in range(n_round_constants)]

    # MDS matrix: Cauchy construction (create_mds_p). Draw 2t field elements as
    # *raw* n-bit grain outputs reduced mod P (NO magnitude rejection here,
    # unlike the round constants). Restart the draw if they are not all
    # distinct, or restart the whole matrix if any denominator (x_i + y_j) == 0.
    while True:
        rand_list = [grain.next_bits_int(N_BITS) % P for _ in range(2 * t)]
        while len(rand_list) != len(set(rand_list)):
            rand_list = [grain.next_bits_int(N_BITS) % P for _ in range(2 * t)]
        xs = rand_list[:t]
        ys = rand_list[t:]
        ok = all(((xs[i] + ys[j]) % P) != 0 for i in range(t) for j in range(t))
        if not ok:
            continue
        # cauchy[i][j] = 1/(x_i + y_j) is the matrix APPLIED to the state
        # (out = cauchy . in). circomlib's Mix computes out[i] = sum_j M[j][i]*in[j]
        # = (M^T . in)[i]; to make that equal cauchy . in, the STORED matrix
        # must be cauchy^T. Store the transpose.
        cauchy = [[inv((xs[i] + ys[j]) % P) for j in range(t)] for i in range(t)]
        mds_stored = mat_transpose(cauchy)
        return round_constants, mds_stored


# ---------------------------------------------------------------------------
# Appendix B optimization: optimized constants C, pre-sparse matrix P,
# per-round sparse matrices S.
#
# Follows the standard equivalent-permutation transformation also used by
# the independent neptune / poseidon-rs implementations.
# ---------------------------------------------------------------------------
def vec_mul_matrix(v, A):
    """Row-vector times matrix: res[j] = sum_i v[i] * A[i][j]."""
    n = len(A)
    res = [0] * n
    for j in range(n):
        s = 0
        for i in range(n):
            s += v[i] * A[i][j]
        res[j] = s % P
    return res


def matrix_mul_vec(A, v):
    """Matrix times column-vector: res[i] = sum_j A[i][j] * v[j]."""
    n = len(A)
    res = [0] * n
    for i in range(n):
        s = 0
        for j in range(n):
            s += A[i][j] * v[j]
        res[i] = s % P
    return res


def convert_constants(t, C, M, r_f, r_p):
    """Fold the raw round constants into the optimized constant vector.

    Mirrors the equivalent-representation derivation of Appendix B. M here is
    the matrix actually applied to the state (the transpose of the stored MDS).
    """
    res = []
    Minv = mat_inverse(M)

    # First t constants pass through unchanged.
    for k in range(t):
        res.append(C[k])

    # First (R_F/2 - 1) full rounds: fold each block through M^{-1}.
    for r in range(r_f // 2 - 1):
        cr = C[(r + 1) * t:(r + 1) * t + t]
        crt = vec_mul_matrix(cr, Minv)
        res.extend(crt)

    # Partial-round block, processed backwards.
    partial_const = []
    acc = [C[(r_f // 2 + r_p) * t + k] for k in range(t)]
    for r in range(r_f // 2 + r_p - 1, r_f // 2 - 1, -1):
        accp = vec_mul_matrix(acc, Minv)
        partial_const.append(accp[0])
        accp[0] = 0
        acc = [(accp[k] + C[r * t + k]) % P for k in range(t)]

    # The accumulated vector becomes the pre-sparse round constant.
    accp = vec_mul_matrix(acc, Minv)
    res.extend(accp)

    # Per-partial-round scalar constants, in forward order.
    for i in range(len(partial_const)):
        res.append(partial_const[len(partial_const) - 1 - i])

    # Trailing full rounds: fold each block through M^{-1}.
    for r in range(r_f // 2 + r_p, r_f + r_p - 1):
        cr = C[(r + 1) * t:(r + 1) * t + t]
        crt = vec_mul_matrix(cr, Minv)
        res.extend(crt)

    return res


def sparse_factorize(m):
    """Decompose m = mp * M_sparse, returning (mp, S) where S is the flattened
    sparse representation [m[0][0], wp..., m[0][1..]].

    m_hat = m[1:,1:]; w = first column tail; wp = m_hat^{-1} * w.
    """
    n = len(m)
    m_hat = [[m[i][j] for j in range(1, n)] for i in range(1, n)]
    w = [m[i][0] for i in range(1, n)]

    mp = [[0] * n for _ in range(n)]
    mp[0][0] = 1
    for i in range(1, n):
        for j in range(1, n):
            mp[i][j] = m[i][j]

    m_hat_inv = mat_inverse(m_hat)
    wp = matrix_mul_vec(m_hat_inv, w)

    S = [m[0][0]]
    S.extend(wp)
    for k in range(1, n):
        S.append(m[0][k])
    return mp, S


def calculate_ps(t, M, r_p):
    """Compute the pre-sparse matrix P and the flattened sparse array S."""
    sparse = []
    m = [row[:] for row in M]
    for _ in range(r_p):
        mp, mpp = sparse_factorize(m)
        sparse.append(mpp)
        m = mat_mul(M, mp)
    P_mat = m

    S = []
    for i in range(len(sparse)):
        S.extend(sparse[len(sparse) - 1 - i])
    return P_mat, S


def optimize(mds_stored, round_constants, t, r_f, r_p):
    """Produce optimized C, stored M, pre-sparse P, flattened S.

    The optimization operates on oM = transpose(stored MDS) = the matrix
    actually applied to the state. Both P and the stored MDS are returned in
    the SAME convention circomlib uses (i.e. oM itself), since circomlib's
    JS generator pushes oM as the stored matrix.
    """
    # circomlibjs computes oM = transpose(raw cauchy) and uses oM both as the
    # stored MDS and as the matrix fed to the optimization. Our mds_stored is
    # already transpose(cauchy) == oM, so use it directly.
    oM = mds_stored
    flat_c = convert_constants(t, round_constants, oM, r_f, r_p)
    P_mat, flat_s = calculate_ps(t, oM, r_p)
    assert len(flat_c) == t * r_f + r_p, (len(flat_c), t * r_f + r_p)
    assert len(flat_s) == r_p * (2 * t - 1)
    return flat_c, oM, P_mat, flat_s


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def generate(t):
    r_p = N_ROUNDS_P[t - 2]
    rc, mds = grain_constants(t, R_F, r_p)
    flat_c, M, Pmat, flat_s = optimize(mds, rc, t, R_F, r_p)
    return {
        "C": flat_c,
        "M": M,
        "P": Pmat,
        "S": flat_s,
        "raw_rc": rc,
        "raw_mds": mds,
        "r_p": r_p,
    }


if __name__ == "__main__":
    for t in (2, 3):
        g = generate(t)
        print(f"t={t}: |C|={len(g['C'])} |S|={len(g['S'])} "
              f"|M|={len(g['M'])}x{len(g['M'][0])} |P|={len(g['P'])}x{len(g['P'][0])}")
