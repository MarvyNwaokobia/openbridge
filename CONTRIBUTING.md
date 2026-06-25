<!--
OpenBridge — CONTRIBUTING.md
Guide for builders adding new market corridors.
Built for the Interledger Open Payments Accelerator 2026.
-->

# Contributing to OpenBridge

OpenBridge is built so that **the next market is a pull request, not a rewrite.** The expensive, shared work — running [Rafiki](https://rafiki.dev) correctly, GNAP consent, quote disclosure, the payment-event plumbing, and the ZK account-linkage pattern — already exists. A new corridor only has to teach the gateway how to move money on **one new rail.**

If you're building in a market with a strong domestic instant-payment rail and no Open Payments on-ramp, this guide is for you. Worked examples below:

- **Kenya — M-Pesa** via the [Safaricom Daraja API](https://developer.safaricom.co.ke/) (B2C for payouts, C2B/STK Push for debits)
- **Ghana — MTN MoMo** via the [MTN MoMo API](https://momodeveloper.mtn.com/) (Disbursements for payouts, Collections for debits)
- **South Africa** via [PayFast](https://developers.payfast.co.za/) or [Peach Payments](https://developer.peachpayments.com/)

## The contract: `ICorridorConnector`

Every corridor implements one interface — [`packages/corridor-core/src/index.ts`](./packages/corridor-core/src/index.ts). The gateway depends only on this surface, never on a concrete PSP SDK, which is what keeps corridors swappable.

```ts
interface ICorridorConnector {
  readonly region: CorridorRegion;     // your market's ISO 3166-1 alpha-2 code
  readonly asset: Asset;               // { code: 'KES', scale: 2 } etc.

  initialize(): Promise<void>;         // validate config, build PSP client, check creds
  payout(request: PayoutRequest): Promise<PayoutResult>;   // money IN -> user's real account
  debit(request: DebitRequest): Promise<DebitResult>;      // money OUT <- user's real account
  getBalance(): Promise<BalanceResult>;
  healthCheck(): Promise<HealthCheckResult>;
}
```

Two methods do the real work:

- **`payout()`** runs when an Open Payments **incoming** payment completes. Translate it into a payout on your rail (M-Pesa B2C, MoMo Disbursement, a PayFast payout). MUST be idempotent on `request.idempotencyKey`.
- **`debit()`** runs when the user authorises an **outgoing** payment via a GNAP grant. Translate it into a charge on your rail (M-Pesa STK Push, MoMo Collection). MUST NOT move money without a valid `request.authorizationRef`, and MUST be idempotent.

Amounts are always `bigint` in the asset's smallest unit (minor units) — never floats.

## Implementing a new corridor, step by step

### 1. Research your PSP and rail

Before writing code, confirm:

- **Payout API** — can you programmatically send money to an arbitrary account/phone number on the rail? (Daraja B2C, MoMo Disbursement.)
- **Debit/collection API** — can you pull/collect funds with user authorization? (Daraja STK Push, MoMo Collection.)
- **Sandbox** — is there a self-serve sandbox you can test against without real money or a long approval gate? (All three examples have one.)
- **Idempotency** — does the API accept an idempotency key, or do you need to dedupe on your side?
- **Webhooks** — how does the rail report final settlement (success/failure) asynchronously?
- **Account identifier** — what is the destination handle (phone number for M-Pesa/MoMo, account id for PayFast)? Map it onto `CorridorAccountRef.handle`.

Write findings into `docs/corridors/<market>.md` so the next person doesn't repeat the research.

### 2. Scaffold the package

```bash
cp -r packages/corridor-nigeria packages/corridor-kenya
```

Then:

- Rename the package in `packages/corridor-kenya/package.json` (e.g. `@openbridge/corridor-kenya`).
- Add `"packages/corridor-kenya"` to the root [`package.json`](./package.json) `workspaces` array.
- Add a feature flag `ENABLE_KENYA` to [`.env.example`](./.env.example) and read it in the gateway.

### 3. Implement the interface

In `packages/corridor-kenya/src/index.ts`, implement `ICorridorConnector` against your PSP SDK. Rules:

- **Strict TypeScript, no `any`.** Reuse the types from `corridor-core`.
- **Idempotent `payout()` and `debit()`** keyed on `idempotencyKey`.
- **No raw secrets in code** — read everything from `CorridorConfig.credentials`, which the gateway populates from env.
- **Map failures, don't throw blind.** Return `status: 'failed'` with a `failureCode`/`failureReason` so the gateway can reconcile.

### 4. Register the corridor

- Wire the connector into the gateway's corridor registry in `packages/gateway-api`.
- Add the corridor's asset and any ILP peering to `packages/rafiki-config`.

### 5. (Optional) ZK account linkage

If your market has a verifiable account/identity attestation, adapt `packages/zk-linkage` — the Noir/UltraHonk + Poseidon2 commitment pattern is market-agnostic. Keep proof generation client-side and store only commitments.

## Testing your corridor

Test against the [Open Payments test wallet](https://wallet.interledger-test.dev/) and your PSP sandbox:

1. **Unit** — mock the PSP client; assert `payout()`/`debit()` build correct requests and are idempotent (same key twice → one movement).
2. **Health** — `healthCheck()` against the live sandbox returns `healthy: true` with valid creds and `false` with bad creds.
3. **End-to-end** — bring up the stack (`npm run rafiki:up`), issue a wallet address on your corridor, then drive a full Open Payments payment from the test wallet and confirm settlement lands in your PSP sandbox:

   ```bash
   npm run rafiki:up
   npm run dev
   npm run cli -- wallet:create --username demo --corridor KE
   npm run cli -- pay:demo --to '$openbridge.org/demo' --amount 1000 --asset KES
   ```

4. **Run the suite** — `npm test` must pass, including `nargo test` if you touched the circuit.

## Submitting a PR

1. **Open an issue first** describing your market, PSP, and rail so we can help you scope it before you build.
2. Branch: `corridor/<market>` (e.g. `corridor/kenya-mpesa`).
3. Keep the PR focused on one corridor. Include the `docs/corridors/<market>.md` research note and tests.
4. Ensure `npm run typecheck`, `npm test`, and `npm run lint` all pass.
5. In the PR description, state which sandbox you tested against and paste a sample successful settlement reference.

## Code style

- Strict TypeScript, no `any`; reuse `corridor-core` types.
- Conventional-ish commits (`feat(corridor-kenya): …`, `fix(gateway): …`).
- Every new file gets a header comment: project name, file purpose, and "Built for the Interledger Open Payments Accelerator 2026."

Questions? Open an issue or reach the maintainer: [marvynwaokobia@gmail.com](mailto:marvynwaokobia@gmail.com).
