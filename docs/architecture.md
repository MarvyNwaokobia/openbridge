<!--
OpenBridge — docs/architecture.md
System architecture reference.
Built for the Interledger Open Payments Accelerator 2026.
-->

# OpenBridge Architecture

OpenBridge is an Open Payments **account provider** — an Account Servicing Entity (ASE) — that issues working wallet addresses (`$openbridge.org/username`) to people whose real-world accounts have no native way onto the Open Payments network, and settles real money into and out of those accounts.

This document expands the [README architecture section](../README.md#architecture) into a full reference: the system overview, each component, the data flows, environment setup, and how to add a new corridor.

## 1. System overview

OpenBridge is one ASE composed of two halves with a deliberately narrow seam between them:

- **The protocol half — Rafiki.** Runs the Open Payments protocol: wallet address resolution, GNAP authorization, and the resource server (incoming payments, outgoing payments, quotes). It tracks balances and runs Interledger settlement internally. It does **not** know about Paystack or Stripe.
- **The settlement half — OpenBridge's gateway + corridor connectors.** Listens to Rafiki's payment lifecycle events and turns an internal balance change into actual money movement on a real rail (NUBAN/NIBSS, Faster Payments, ACH). It does **not** know about GNAP.

They meet at **payment lifecycle events**. That boundary is the whole design: it is why a new market is one new module rather than a redesign.

```
                            ┌───────────────────────────────────────┐
                            │          OPEN PAYMENTS NETWORK         │
                            │   (any OP-compliant client / wallet)   │
                            └────────────────────┬──────────────────┘
                                                 │  Open Payments + GNAP (HTTP)
                                                 ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │                              RAFIKI CORE  (ASE)                          │
        │   Wallet Address Server  │  Auth Server (GNAP)  │  Resource Server (OP)  │
        └───────────────┬──────────────────────────────────────────┬─────────────┘
                        │  payment lifecycle events / webhooks       │
                        ▼                                            ▼
        ┌────────────────────────────────────────┐   ┌──────────────────────────────┐
        │             GATEWAY API                 │   │       ZK-LINKAGE VERIFIER     │
        │  orchestration · corridor routing ·     │   │  UltraHonk proof verification │
        │  user & corridor-mapping store · KYC    │   │  (account ownership, no PII)  │
        └───────┬───────────────┬─────────────┬───┘   └──────────────────────────────┘
                ▼               ▼             ▼
        ┌───────────────┐ ┌───────────┐ ┌───────────┐     shared corridor-core interface
        │ CORRIDOR NG   │ │CORRIDOR UK│ │CORRIDOR US│     (one module per rail)
        │ Paystack      │ │ Stripe    │ │ Stripe    │
        │ NUBAN/NIBSS   │ │ Faster Pay│ │ ACH       │
        └──────┬────────┘ └─────┬─────┘ └─────┬─────┘
               ▼                ▼             ▼
           REAL ACCOUNTS    REAL ACCOUNTS  REAL ACCOUNTS
```

## 2. Components

### 2.1 Rafiki (ASE core)

Rafiki is Interledger's open-source reference ASE. OpenBridge **deploys and configures** it — it does not fork it — and integrates over its documented surface:

- **Wallet address server** — resolves `GET https://openbridge.org/username` to a wallet address resource (asset, auth-server URL, resource-server URL).
- **GNAP authorization server** — issues and manages grants; interactive grants drive user consent. OpenBridge supplies the consent UI that Rafiki redirects to.
- **Open Payments resource server** — `/incoming-payments`, `/outgoing-payments`, `/quotes`, with full access-token enforcement.
- **Backend Admin API (GraphQL)** — how the gateway creates wallet addresses, peers, quotes, and payments.
- **Webhook/event stream** — how the gateway learns a payment completed and needs settling.

What Rafiki intentionally leaves to the operator is **settlement to the outside world** — moving real money. That is the gateway + corridors' job.

Config lives in `packages/rafiki-config` and `docker-compose.yml`.

### 2.2 Gateway API (`packages/gateway-api`)

The coordinator and the only component that talks to both halves. Responsibilities:

- Receive Rafiki webhooks for payment lifecycle events and route each to the correct corridor by the user's linked account.
- Call the Rafiki Backend Admin API to create wallet addresses, quotes, and payments on the user's behalf.
- Own the **application datastore**: users, corridor mappings, and ZK commitment records (Postgres).
- Use Redis for GNAP grant caching, interaction sessions, and rate limiting.
- Invoke the ZK-linkage verifier during account linking.

The gateway depends only on the `ICorridorConnector` interface from `corridor-core`, never on a concrete PSP SDK.

### 2.3 Corridor connectors (`packages/corridor-*`)

Each corridor maps Open Payments flow onto exactly one real-world rail and implements the same `ICorridorConnector` interface (see [`packages/corridor-core/src/index.ts`](../packages/corridor-core/src/index.ts)):

| Corridor | Package | PSP | Rail | Coverage |
|---|---|---|---|---|
| Nigeria | `corridor-nigeria` | Paystack | NUBAN / NIBSS | OPay, Paga, Moniepoint, GTBank, Kuda, all commercial banks |
| UK | `corridor-uk` | Stripe Connect | Faster Payments | UK bank accounts |
| US | `corridor-us` | Stripe Connect | ACH | US bank accounts |

The interface is small on purpose: `initialize()`, `payout()`, `debit()`, `getBalance()`, `healthCheck()`. `payout()` settles an incoming payment into a real account; `debit()` pulls from a real account to fund an outgoing payment.

### 2.4 ZK privacy layer (`packages/zk-linkage`)

On the Nigeria corridor, a user can link an account by **proving ownership without revealing it**. A Noir/UltraHonk circuit (see [`circuits/account_linkage/src/main.nr`](../packages/zk-linkage/circuits/account_linkage/src/main.nr)) proves knowledge of an `(account_number, bank_code, owner_name)` tuple that:

1. Hashes (Poseidon2) to a commitment OpenBridge holds,
2. Belongs to a licensed Nigerian institution, and
3. Matches the OpenBridge user's registered identity —

without disclosing the underlying data. **Proof generation is client-side**; **verification is server-side** on the gateway, which records only the commitment. The architecture generalises to transaction-level privacy and selective compliance disclosure in later phases.

### 2.5 Onboarding UI (`apps/onboarding-ui`)

The user-facing surface: wallet-address creation and management, account linking (including client-side ZK proving), and the **GNAP interactive-grant consent screens** that Rafiki's auth server redirects users to when they authorise an outgoing payment.

## 3. Data flows

### 3.1 Incoming payment (money lands in a real account)

```
Sender's OP client                Rafiki Core              Gateway API            Corridor (PSP)
       │                              │                        │                       │
       │ 1. GET /username (resolve)   │                        │                       │
       │─────────────────────────────▶                        │                       │
       │ 2. GNAP grant (incoming)     │                        │                       │
       │─────────────────────────────▶                        │                       │
       │ 3. POST /incoming-payments   │                        │                       │
       │─────────────────────────────▶                        │                       │
       │ 4. ILP settlement (internal) │                        │                       │
       │        ... payment completes ...                      │                       │
       │                              │ 5. webhook: completed  │                       │
       │                              │───────────────────────▶│                       │
       │                              │                        │ 6. route by mapping   │
       │                              │                        │──────────────────────▶│ payout()
       │                              │                        │                       │ 7. Paystack Transfer
       │                              │                        │                       │   -> NUBAN account
```

### 3.2 Outgoing payment (money pulled from a real account)

```
User (onboarding UI)              Rafiki Core              Gateway API            Corridor (PSP)
       │ 1. initiate send             │                        │                       │
       │─────────────────────────────────────────────────────▶│                       │
       │                              │ 2. POST /quotes        │                       │
       │                              │◀───────────────────────│ (fees disclosed)      │
       │ 3. GNAP interactive grant    │                        │                       │
       │   (user approves in UI)      │                        │                       │
       │─────────────────────────────▶                        │                       │
       │                              │ 4. POST /outgoing-pay  │                       │
       │                              │◀───────────────────────│                       │
       │                              │ 5. webhook: created    │                       │
       │                              │───────────────────────▶│ debit()               │
       │                              │                        │──────────────────────▶│ Paystack Charge /
       │                              │                        │                       │ Stripe charge
```

### 3.3 ZK account linkage

```
User device (client)                                   Gateway API
       │ 1. enter account details (local only)              │
       │ 2. Poseidon2 commitment + UltraHonk proof          │
       │    (raw details never leave the device)            │
       │ 3. POST { commitment, proof } ────────────────────▶│
       │                                                    │ 4. verify UltraHonk proof
       │                                                    │ 5. store commitment ONLY
       │ 6. linked ◀────────────────────────────────────────│   (no raw account number)
```

## 4. Environment setup

Prerequisites: Node.js ≥ 20, npm ≥ 10, Rust toolchain + Nargo (Noir), Docker + Docker Compose.

```bash
git clone https://github.com/MarvyNwaokobia/openbridge.git
cd openbridge
npm install
cp .env.example .env          # fill in Paystack/Stripe sandbox keys

npm run rafiki:up             # Rafiki backend + auth, Postgres, Redis
npm run rafiki:migrate
npm run rafiki:seed

npm run zk:build              # compile the Noir circuit + verification key
npm run dev                   # gateway API on :4000
npm run dev:ui                # onboarding UI on :5173
```

See `.env.example` for every variable and what it does. Datastore layout (single Postgres instance, three databases) is defined in `docker-compose.yml` and `infra/postgres/init.sql`.

## 5. Adding a new corridor

The expensive, shared work — Rafiki, GNAP consent, quote disclosure, event plumbing, the ZK pattern — already exists. A new market only teaches the gateway how to move money on one new rail.

1. **Scaffold.** Copy `packages/corridor-nigeria` to `packages/corridor-<market>` and add it to the root `workspaces` array.
2. **Implement `ICorridorConnector`.** Map `payout()` to a payout on your rail and `debit()` to a charge, against your market's PSP (e.g. Safaricom Daraja for M-Pesa, MTN MoMo API for Ghana). No `any` — keep the strict types from `corridor-core`.
3. **Register it.** Wire the connector into `gateway-api`'s corridor registry and add a feature flag (`ENABLE_<MARKET>`).
4. **Add the asset.** Register the corridor's asset/peering in `packages/rafiki-config`.
5. **(Optional) ZK linkage.** Adapt `packages/zk-linkage` if your market supports a verifiable account/identity attestation.
6. **Test** against the Open Payments test wallet and your PSP sandbox, then open a PR.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the step-by-step guide aimed at builders in other markets.
