# @openbridge/zk-linkage

Zero-knowledge account-linkage for the OpenBridge Nigeria corridor. A user proves
they own a valid, KYC-verified Nigerian account **without revealing the account**
to OpenBridge.

- **Circuit:** [`circuits/account_linkage/src/main.nr`](./circuits/account_linkage/src/main.nr) (Noir 0.30+)
- **Proving system:** UltraHonk
- **Commitment hash:** Poseidon2 (matches the project's Shielded Token scheme)
- **Proof generation:** client-side (browser/device) — raw account details never leave the user
- **Verification:** server-side on OpenBridge's gateway — stores only the commitment

```bash
npm run build   # nargo compile -> target/account_linkage.json
npm test        # nargo test
```

See [`docs/architecture.md`](../../docs/architecture.md#24-zk-privacy-layer-packageszk-linkage) for the full proof statement and how it extends to transaction-level privacy.

Built for the Interledger Open Payments Accelerator 2026.
