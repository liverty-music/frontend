#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Verify generated Poseidon constants against the local circomlib oracle.
import re
import sys
import generate

# Pass the GPL circomlib poseidon_constants.circom path as argv[1] to diff against.
ORACLE = sys.argv[1] if len(sys.argv) > 1 else "node_modules/circomlib/circuits/poseidon_constants.circom"


def slice_function(text, fname):
    """Extract the body text of function POSEIDON_X(t)."""
    m = re.search(r"function %s\(t\)\s*\{" % re.escape(fname), text)
    start = m.end()
    depth = 1
    i = start
    while depth > 0:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    return text[start:i - 1]


def slice_branch(body, t):
    """Extract the text returned for a particular t within a function body."""
    if t == 2:
        m = re.search(r"if\s*\(\s*t\s*==\s*2\s*\)\s*\{", body)
    else:
        m = re.search(r"else if\s*\(\s*t\s*==\s*%d\s*\)\s*\{" % t, body)
    start = m.end()
    depth = 1
    i = start
    while depth > 0:
        if body[i] == "{":
            depth += 1
        elif body[i] == "}":
            depth -= 1
        i += 1
    return body[start:i - 1]


HEX = re.compile(r"0x[0-9a-fA-F]+")


def parse_flat(branch_text):
    return [int(x, 16) for x in HEX.findall(branch_text)]


def parse_matrix(branch_text, n):
    vals = parse_flat(branch_text)
    assert len(vals) == n * n, (len(vals), n * n)
    return [vals[i * n:(i + 1) * n] for i in range(n)]


def main():
    text = open(ORACLE).read()
    body_c = slice_function(text, "POSEIDON_C")
    body_m = slice_function(text, "POSEIDON_M")
    body_p = slice_function(text, "POSEIDON_P")
    body_s = slice_function(text, "POSEIDON_S")

    total_ok = True
    for t in (2, 3):
        g = generate.generate(t)
        oc = parse_flat(slice_branch(body_c, t))
        om = parse_matrix(slice_branch(body_m, t), t)
        op = parse_matrix(slice_branch(body_p, t), t)
        os_ = parse_flat(slice_branch(body_s, t))

        results = {}
        results["C"] = (g["C"], oc)
        results["M"] = ([x for row in g["M"] for x in row],
                        [x for row in om for x in row])
        results["P"] = ([x for row in g["P"] for x in row],
                        [x for row in op for x in row])
        results["S"] = (g["S"], os_)

        print(f"=== t={t} ===")
        for name, (gen, ora) in results.items():
            if len(gen) != len(ora):
                print(f"  {name}: LENGTH MISMATCH gen={len(gen)} oracle={len(ora)}")
                total_ok = False
                continue
            mism = [i for i in range(len(gen)) if gen[i] != ora[i]]
            if mism:
                print(f"  {name}: {len(gen)-len(mism)}/{len(gen)} match, "
                      f"{len(mism)} MISMATCH (first idx {mism[0]})")
                print(f"      gen[{mism[0]}]   = {hex(gen[mism[0]])}")
                print(f"      oracle[{mism[0]}]= {hex(ora[mism[0]])}")
                total_ok = False
            else:
                print(f"  {name}: {len(gen)}/{len(gen)} match  OK")

    print()
    print("ALL MATCH" if total_ok else "DIVERGENCE DETECTED")
    return 0 if total_ok else 1


if __name__ == "__main__":
    sys.exit(main())
