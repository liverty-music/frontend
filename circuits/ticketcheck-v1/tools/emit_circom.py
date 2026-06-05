#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Emit poseidon_constants.circom (t=2, t=3) from the clean-room generator.
import generate

HEADER = """// SPDX-License-Identifier: MIT
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
// Poseidon-BN254 optimized round constants and matrices for circuit widths
// t = 2 and t = 3 (alpha = 5 S-box, R_F = 8, R_P = 56 / 57).
//
// These values were INDEPENDENTLY REGENERATED from the public academic
// references (see generate.py): the Poseidon Grain LFSR parameter generator
// (Grassi-Khovratovich-Rechberger-Roy-Schofnegger, ePrint 2019/458; IAIK
// hadeshash generate_parameters_grain.sage) and the Appendix B sparse-MDS
// round optimization. No GPL-licensed source was copied.
//
// Layout matches the optimized Poseidon permutation:
//   POSEIDON_C(t): flattened optimized round constants, length t*R_F + R_P.
//   POSEIDON_M(t): t x t MDS matrix (stored convention: Mix reads M[j][i]).
//   POSEIDON_P(t): t x t pre-sparse matrix (full -> partial transition).
//   POSEIDON_S(t): flattened sparse matrices, length R_P*(2t-1).
// Only t = 2 and t = 3 are defined; other widths return placeholders.
// ============================================================================

pragma circom 2.0.0;
"""


def fmt(x):
    return hex(x)


def emit_flat_function(name, data_by_t):
    lines = [f"function {name}(t) {{"]
    first = True
    for t, arr in data_by_t.items():
        cond = "if" if first else "} else if"
        lines.append(f"    {cond} (t == {t}) {{")
        lines.append("        return [")
        for i, v in enumerate(arr):
            comma = "," if i < len(arr) - 1 else ""
            lines.append(f"            {fmt(v)}{comma}")
        lines.append("        ];")
        first = False
    lines.append("    } else {")
    lines.append("        return [0];")
    lines.append("    }")
    lines.append("}")
    return "\n".join(lines)


def emit_matrix_function(name, data_by_t):
    lines = [f"function {name}(t) {{"]
    first = True
    for t, mat in data_by_t.items():
        cond = "if" if first else "} else if"
        lines.append(f"    {cond} (t == {t}) {{")
        lines.append("        return [")
        for ri, row in enumerate(mat):
            lines.append("            [")
            for ci, v in enumerate(row):
                comma = "," if ci < len(row) - 1 else ""
                lines.append(f"                {fmt(v)}{comma}")
            rcomma = "," if ri < len(mat) - 1 else ""
            lines.append(f"            ]{rcomma}")
        lines.append("        ];")
        first = False
    lines.append("    } else {")
    lines.append("        return [[0]];")
    lines.append("    }")
    lines.append("}")
    return "\n".join(lines)


def main():
    gens = {t: generate.generate(t) for t in (2, 3)}
    C = {t: gens[t]["C"] for t in (2, 3)}
    M = {t: gens[t]["M"] for t in (2, 3)}
    Pm = {t: gens[t]["P"] for t in (2, 3)}
    S = {t: gens[t]["S"] for t in (2, 3)}

    out = [HEADER, ""]
    out.append(emit_flat_function("POSEIDON_C", C))
    out.append("")
    out.append(emit_matrix_function("POSEIDON_M", M))
    out.append("")
    out.append(emit_matrix_function("POSEIDON_P", Pm))
    out.append("")
    out.append(emit_flat_function("POSEIDON_S", S))
    out.append("")

    with open("poseidon_constants.circom", "w") as f:
        f.write("\n".join(out))
    print("wrote poseidon_constants.circom")


if __name__ == "__main__":
    main()
