// MIT/Apache-2.0 browser WASM Groth16 prover for the TicketCheck circuit.
//
// Replaces the GPL-3.0 snarkjs runtime. Generates a BN254 Groth16 proof entirely
// in-browser (the private `trapdoor` never leaves the device) by:
//   1. running the circom witness calculator `.wasm` via wasmer's `js` backend
//      (the browser's own WebAssembly engine),
//   2. proving with arkworks `ark-groth16` using `CircomReduction` and the existing
//      snarkjs `.zkey` (parsed by `ark_circom::read_zkey`),
//   3. serializing the proof to the snarkjs `proof.json` shape that the backend's
//      `vocdoni/circom2gnark` -> `gnark.Verify` parses (G2 limb order `[c0, c1]`).
//
// All inputs are passed as bytes so there is no filesystem dependency in the browser.

use ark_bn254::{Bn254, Fq2, Fr};
use ark_circom::circom::R1CSFile;
use ark_circom::{read_zkey, CircomBuilder, CircomConfig, CircomReduction, WitnessCalculator};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::Groth16;
use ark_snark::SNARK;
use num_bigint::{BigInt, BigUint};
use std::io::Cursor;
use std::str::FromStr;
use wasm_bindgen::prelude::*;
use wasmer::{Module, Store};

fn fe_to_dec<F: PrimeField>(f: &F) -> String {
    BigUint::from_bytes_le(&f.into_bigint().to_bytes_le()).to_string()
}

fn err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// Generate a proof for the TicketCheck circuit.
///
/// `input_json` is the circom input object (decimal string / array values:
/// `trapdoor`, `merkleRoot`, `eventId`, `pathElements[]`, `pathIndices[]`,
/// `nullifierHash`). `wasm`/`r1cs`/`zkey` are the raw circuit-artifact bytes.
///
/// Returns a JSON string `{"proof": <snarkjs proof.json>, "publicSignals": [..]}`.
// NOTE: parameter names become the generated JS parameter names. Avoid `wasm`,
// which would shadow wasm-bindgen's internal module-level `wasm` exports object.
#[wasm_bindgen]
pub fn prove(
    input_json: &str,
    circuit_wasm: &[u8],
    circuit_r1cs: &[u8],
    proving_key: &[u8],
) -> Result<String, JsValue> {
    console_error_panic_hook::set_once();
    let mut store = Store::default();
    let module = Module::new(&store, circuit_wasm).map_err(err)?;
    let wtns = WitnessCalculator::from_module(&mut store, module).map_err(err)?;
    let r1cs_parsed = R1CSFile::<Fr>::new(Cursor::new(circuit_r1cs))
        .map_err(err)?
        .into();
    let cfg = CircomConfig::<Fr> {
        r1cs: r1cs_parsed,
        wtns,
        store,
        sanity_check: false,
    };

    let mut builder = CircomBuilder::new(cfg);
    let input: serde_json::Value = serde_json::from_str(input_json).map_err(err)?;
    let obj = input
        .as_object()
        .ok_or_else(|| JsValue::from_str("input must be a JSON object"))?;
    for (k, v) in obj {
        let mut push = |s: &str| -> Result<(), JsValue> {
            let n = BigUint::from_str(s).map_err(err)?;
            builder.push_input(k, BigInt::from(n));
            Ok(())
        };
        match v {
            serde_json::Value::String(s) => push(s)?,
            serde_json::Value::Number(n) => push(&n.to_string())?,
            serde_json::Value::Array(arr) => {
                for e in arr {
                    match e {
                        serde_json::Value::String(s) => push(s)?,
                        serde_json::Value::Number(n) => push(&n.to_string())?,
                        _ => return Err(JsValue::from_str("unsupported array element")),
                    }
                }
            }
            _ => return Err(JsValue::from_str("unsupported input value")),
        }
    }

    let circom = builder.build().map_err(err)?;
    let pub_inputs = circom
        .get_public_inputs()
        .ok_or_else(|| JsValue::from_str("missing public inputs"))?;

    let (pk, _) = read_zkey(&mut Cursor::new(proving_key)).map_err(err)?;
    let mut rng = rand::rngs::OsRng;
    // CircomReduction is mandatory: the default QAP reduction yields a proof the
    // snarkjs-built verification key rejects.
    let proof =
        Groth16::<Bn254, CircomReduction>::prove(&pk, circom, &mut rng).map_err(err)?;

    // snarkjs proof.json shape. G1 = [x, y, "1"]; G2 = [[x.c0, x.c1], [y.c0, y.c1], ["1","0"]].
    let g2 = |x: &Fq2| -> Vec<String> { vec![fe_to_dec(&x.c0), fe_to_dec(&x.c1)] };
    let proof_json = serde_json::json!({
        "pi_a": [fe_to_dec(&proof.a.x), fe_to_dec(&proof.a.y), "1"],
        "pi_b": [g2(&proof.b.x), g2(&proof.b.y), ["1", "0"]],
        "pi_c": [fe_to_dec(&proof.c.x), fe_to_dec(&proof.c.y), "1"],
        "protocol": "groth16",
        "curve": "bn128"
    });
    let public_signals: Vec<String> = pub_inputs.iter().map(fe_to_dec).collect();

    let out = serde_json::json!({ "proof": proof_json, "publicSignals": public_signals });
    serde_json::to_string(&out).map_err(err)
}
