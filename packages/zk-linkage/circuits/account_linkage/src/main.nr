// =============================================================================
// OpenBridge - zk-linkage / account_linkage circuit
// Zero-knowledge proof that a user owns a real Nigerian bank/mobile-money
// account, without revealing the account to OpenBridge.
// Built for the Interledger Open Payments Accelerator 2026.
//
// Noir 1.0.0-beta+ / UltraHonk proving system.
//
// -----------------------------------------------------------------------------
// FULL PROOF STATEMENT (what the production circuit attests)
// -----------------------------------------------------------------------------
// The prover knows an (account_number, bank_code, owner_name) tuple such that:
//
//   1. Poseidon2(account_number, bank_code) == commitment_hash
//        -> the prover knows the preimage behind the commitment OpenBridge holds.
//
//   2. The account is registered with a LICENSED Nigerian financial institution
//        -> bank_code is a member of an attested set of licensed bank codes
//           (production: Merkle membership against a published institution root).
//
//   3. The account-holder name MATCHES the OpenBridge user's registered identity
//        -> owner_name_hash equals the identity hash bound to the OpenBridge user.
//
// ...all without revealing account_number, bank_code, or owner_name to the
// verifier. Proof generation runs client-side (the user's browser/device);
// verification runs server-side on OpenBridge's Rafiki instance, which records
// ONLY the commitment - never the raw account details.
//
// -----------------------------------------------------------------------------
// THIS STUB
// -----------------------------------------------------------------------------
// Implements constraint (1) end-to-end and binds (3)'s input so the public
// interface is already the production interface. Constraints (2) and the full
// identity match in (3) are stubbed with TODOs below; wiring them in does not
// change this circuit's signature, only its body.
// =============================================================================

use std::hash::poseidon2_permutation;

// Poseidon2-based commitment over (account_number, bank_code).
//
// This beta release exposes the Poseidon2 *permutation* publicly (the canonical
// sponge `Poseidon2::hash` is crate-private here). We absorb the two field
// inputs into a width-4 state and take the first output element as the
// commitment. The client reproduces this with the same Poseidon2 permutation so
// commitments match bit-for-bit. Production can swap to the canonical sponge
// once it is exposed publicly, without changing this circuit's signature.
fn commit(account_number: Field, bank_code: Field) -> Field {
    let out = poseidon2_permutation([account_number, bank_code, 0, 0]);
    out[0]
}

// Private inputs (witness, never revealed):
//   account_number  - the NUBAN account number, as a Field
//   bank_code       - the institution's NIBSS/CBN bank code, as a Field
//   owner_name_hash - Poseidon2 hash of the normalized account-holder name
//
// Public inputs:
//   commitment_hash - the commitment OpenBridge stored at link time
fn main(
    account_number: Field,
    bank_code: Field,
    owner_name_hash: Field,
    commitment_hash: pub Field,
) {
    // --- Constraint 1: knowledge of the committed (account_number, bank_code) ---
    // Poseidon2 is the ZK-friendly hash used consistently across the project
    // (matches the Shielded Token commitment scheme).
    let computed_commitment = commit(account_number, bank_code);
    assert(computed_commitment == commitment_hash);

    // --- Constraint 3 (partial): bind the identity input ---
    // The account-holder name hash must be present (non-zero). In production this
    // becomes an equality against the identity hash bound to the OpenBridge user,
    // passed as an additional public input `user_identity_hash`:
    //
    //   assert(owner_name_hash == user_identity_hash);
    assert(owner_name_hash != 0);

    // --- Constraint 2 (TODO, production): licensed-institution membership ---
    // Prove `bank_code` is in the published set of licensed Nigerian institutions
    // without revealing which one, via Merkle membership against an attested root:
    //
    //   fn main(..., institution_root: pub Field, merkle_path: [Field; DEPTH],
    //           path_indices: [Field; DEPTH]) { ... }
    //   let leaf = commit(bank_code, 0);
    //   let root = compute_merkle_root(leaf, merkle_path, path_indices);
    //   assert(root == institution_root);
}

// -----------------------------------------------------------------------------
// Tests - run with `nargo test`.
// -----------------------------------------------------------------------------
#[test]
fn test_valid_commitment() {
    let account_number = 1234567890;
    let bank_code = 999992; // example OPay code
    let owner_name_hash = 42;
    let commitment_hash = commit(account_number, bank_code);

    main(account_number, bank_code, owner_name_hash, commitment_hash);
}

#[test(should_fail)]
fn test_wrong_commitment_fails() {
    let account_number = 1234567890;
    let bank_code = 999992;
    let owner_name_hash = 42;
    // A commitment that does not match the (account_number, bank_code) preimage.
    let commitment_hash = 7;

    main(account_number, bank_code, owner_name_hash, commitment_hash);
}

#[test(should_fail)]
fn test_zero_identity_fails() {
    let account_number = 1234567890;
    let bank_code = 999992;
    let owner_name_hash = 0; // must be present
    let commitment_hash = commit(account_number, bank_code);

    main(account_number, bank_code, owner_name_hash, commitment_hash);
}
