<div align="center">

# OpenBridge

**Real Open Payments wallet addresses for the accounts people already have.**

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/MarvyNwaokobia/openbridge)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Open Payments](https://img.shields.io/badge/Open%20Payments-Rafiki-6c47ff)](https://openpayments.dev)
[![Noir](https://img.shields.io/badge/ZK-Noir%20%2F%20UltraHonk-000000)](https://noir-lang.org)

OpenBridge is an Open Payments **account provider** built on [Rafiki](https://rafiki.dev). It issues working `$openbridge.org/username` wallet addresses to people whose Nigerian mobile-money wallets, UK bank accounts, and US bank accounts have no native way onto the Open Payments network — and settles real money into those accounts behind the scenes.

</div>

---

## The problem

Open Payments is a finished, well-designed protocol. It standardises how a wallet address is resolved, how a client requests authorization (via GNAP), how a quote is created, and how incoming and outgoing payments are executed. The hard part is no longer the spec.

The hard part is that **almost nobody has a wallet address.**

Open Payments only works when both sides of a payment are reachable on the network. The sender needs a wallet address to pay from; the receiver needs one to be paid into. But a wallet address is not something an ordinary person can go and get — it has to be issued by an **Account Servicing Entity (ASE)**: a regulated-or-partnered provider that holds the user's funds (or a claim on them) and speaks the Open Payments protocol on their behalf. Banks and mobile-money operators are the natural ASEs, and almost none of them have implemented the standard yet. So the network has rails but no on-ramps. Interledger has named this directly: a two-sided adoption gap where neither side moves first.

Look at where that gap bites hardest:

- **Nigeria** has one of the most active mobile-money and instant-transfer ecosystems in the world — OPay, Paga, Moniepoint, Kuda, plus every commercial bank — all reachable through NUBAN account numbers over NIBSS. None of them issue Open Payments wallet addresses.
- **The UK** runs Faster Payments, settling interbank transfers in seconds. No consumer-facing Open Payments addresses.
- **The US** runs ACH at massive scale. Same story.

These are exactly the accounts that *should* be the first nodes on an open payments network — high-volume, instant-ish, already digital. Instead they sit one integration away from a protocol that can't reach them. OpenBridge is that integration.

## What OpenBridge does

**In plain language:** OpenBridge gives you an Open Payments wallet address — something like `$openbridge.org/marvy` — and links it to a bank or mobile-money account you already have. When someone pays your wallet address over Open Payments, the money lands in your real account. When you authorise a payment out, OpenBridge pulls from your real account and sends it across the network. You don't open a new financial account, you don't move your money somewhere new, and you don't learn a new app to receive money — the address is just a new, open, interoperable *front door* to the account you've had all along.

**The email analogy:** Open Payments is to money what SMTP is to email. SMTP is the reason an address at one provider can send to an address at any other provider without either side coordinating in advance — the protocol is the agreement. Open Payments is that agreement for payments. But imagine SMTP existed and almost nobody had an email address yet: the protocol would be technically complete and practically useless. That's where Open Payments is today. **OpenBridge is an email provider in that world** — it hands out addresses and makes sure mail actually gets delivered to where you really live.

**Technically:** OpenBridge is a Rafiki-based ASE. Rafiki gives it the three Open Payments server roles out of the box — wallet address server, GNAP authorization server, and the Open Payments resource server (incoming payments, outgoing payments, quotes). On top of that, OpenBridge adds a layer Rafiki deliberately leaves to the operator: **the connection to real-world money.** Rafiki tracks balances and runs the protocol; it does not, by itself, move funds in OPay or settle over ACH. OpenBridge supplies that last mile through a set of pluggable **corridor connectors**, each of which translates an Open Payments payment event into a payout (or a charge) on a specific real-world rail via a payment service provider.

The result is a wallet address that is not a demo stub. A payment to it moves real money into a real account.

## Architecture

OpenBridge is one ASE composed of two halves: **the protocol half**, which is Rafiki, and **the settlement half**, which is OpenBridge's own corridor connectors and gateway. The seam between them is deliberate and narrow — Rafiki knows nothing about Paystack or Stripe, and the corridors know nothing about GNAP. They meet at payment lifecycle events.

```
                            ┌───────────────────────────────────────┐
                            │          OPEN PAYMENTS NETWORK         │
                            │   (any OP-compliant client / wallet)   │
                            └────────────────────┬──────────────────┘
                                                 │  Open Payments + GNAP (HTTP)
                                                 │  wallet address · grant · quote · payment
                                                 ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │                              RAFIKI CORE  (ASE)                          │
        │                                                                          │
        │   Wallet Address Server  │  Auth Server (GNAP)  │  Resource Server (OP)  │
        │   $openbridge.org/user   │  grants · interaction│  incoming · outgoing   │
        │                          │                      │  · quotes              │
        └───────────────┬──────────────────────────────────────────┬─────────────┘
                        │  payment lifecycle events / webhooks       │
                        ▼                                            ▼
        ┌────────────────────────────────────────┐   ┌──────────────────────────────┐
        │             GATEWAY API                 │   │       ZK-LINKAGE VERIFIER     │
        │  orchestration · corridor routing ·     │   │  UltraHonk proof verification │
        │  user & corridor-mapping store · KYC    │   │  (account ownership, no PII)  │
        └───────┬───────────────┬─────────────┬───┘   └──────────────────────────────┘
                │               │             │
                ▼               ▼             ▼
        ┌───────────────┐ ┌───────────┐ ┌───────────┐
        │  CORRIDOR     │ │ CORRIDOR  │ │ CORRIDOR  │     shared corridor-core interface
        │  NIGERIA      │ │ UK        │ │ US        │     (one module per rail)
        └──────┬────────┘ └─────┬─────┘ └─────┬─────┘
               │ Paystack       │ Stripe      │ Stripe
               │ Transfer/Charge│ Connect     │ Connect
               ▼                ▼             ▼
        ┌───────────────┐ ┌───────────┐ ┌───────────┐
        │ NUBAN / NIBSS │ │  Faster   │ │   ACH     │
        │ OPay · Paga · │ │  Payments │ │           │
        │ Moniepoint ·  │ │  (UK)     │ │  (US)     │
        │ Kuda · banks  │ │           │ │           │
        └───────────────┘ └───────────┘ └───────────┘
            REAL ACCOUNTS      REAL ACCOUNTS   REAL ACCOUNTS
```

### Core stack

| Layer | Technology | Role |
|---|---|---|
| ASE / protocol | **Rafiki** | Open Payments wallet address server, GNAP auth server, OP resource server |
| Implementation | **Node.js / TypeScript** | Matches Rafiki's stack; gateway, corridors, tooling |
| Persistent store | **PostgreSQL** | User accounts, corridor mappings, ZK proof / commitment records |
| Cache & sessions | **Redis** | GNAP grant caching, interaction sessions, rate limiting |
| Privacy | **Noir + UltraHonk** | Client-side ZK proof of account ownership; server-side verification |
| Local infra | **Docker Compose** | Rafiki, Postgres, Redis for local development and CI |

### Rafiki as the ASE core

Rafiki is Interledger's open-source reference ASE. OpenBridge runs it as the protocol engine and does **not** fork it — it configures and deploys it, then integrates over its documented surface (Backend Admin API, Open Payments endpoints, and webhook/event stream). That gives OpenBridge three things for free and keeps them spec-correct:

1. **Wallet address server** — resolves `GET https://openbridge.org/username` to a wallet address resource (asset, auth server, resource server URLs).
2. **GNAP authorization server** — issues and manages grants. Interactive grants drive the user-consent step; OpenBridge supplies the interaction UI that Rafiki redirects to.
3. **Open Payments resource server** — the `/incoming-payments`, `/outgoing-payments`, and `/quotes` endpoints, with all the access-token enforcement the protocol requires.

What Rafiki intentionally leaves open is **settlement to the outside world.** Its accounting is internal; turning an internal balance change into money in someone's OPay wallet is the operator's job. OpenBridge listens to Rafiki's payment lifecycle events and fulfils that job through corridors.

### Corridor connectors

A **corridor** is a module that maps Open Payments payment flow onto one real-world rail. Every corridor implements the same interface from `corridor-core`, so the gateway treats Nigeria, UK, and US identically and routes by the user's linked account:

```ts
interface Corridor {
  readonly region: 'NG' | 'GB' | 'US';
  readonly asset: { code: string; scale: number };

  // Money in: an Open Payments incoming payment completed -> pay the user's real account.
  settleIncoming(event: IncomingPaymentCompleted): Promise<PayoutResult>;

  // Money out: a user-authorised outgoing payment -> pull from the user's real account.
  fundOutgoing(event: OutgoingPaymentCreated): Promise<ChargeResult>;

  // Account linking: validate that a user controls the real account they claim.
  linkAccount(req: LinkAccountRequest): Promise<LinkAccountResult>;
}
```

Adding a new market is implementing this interface once — not redesigning the system. That is the whole point of the boundary, and it's what makes the "Contributing" section below a real invitation rather than a courtesy.

### Open Payments flow, end to end

A complete payment into an OpenBridge wallet address:

1. **Wallet address resolution** — the sending client does `GET https://openbridge.org/username` and learns the auth server and resource server URLs.
2. **Grant request (GNAP)** — the client asks the authorization server for access to create the relevant resource (an `incoming-payment` on the receiver, or `quote` + `outgoing-payment` on the sender).
3. **User authorization (GNAP interactive grant)** — for outgoing payments the user explicitly approves the grant through OpenBridge's onboarding/consent UI; nothing moves without that consent.
4. **Quote creation (`POST /quotes`)** — fees and any currency conversion are computed and disclosed *before* money moves. The user sees the real number first.
5. **Payment execution** — `POST /incoming-payments` on the receiver and/or `POST /outgoing-payments` on the sender; Rafiki runs the Interledger settlement and updates internal balances.
6. **Corridor settlement** — Rafiki emits the completion event; the gateway routes it to the right corridor; the corridor calls Paystack or Stripe and the funds land in (or are pulled from) the user's real account.

## The three corridors

All three corridors share one interface and one design. They differ only in PSP configuration and rail.

### Corridor 1 — Nigeria *(primary; live)*

| | |
|---|---|
| **PSP** | Paystack |
| **Rail** | NUBAN / NIBSS |
| **Coverage** | OPay, Paga, Moniepoint, GTBank, Kuda, and every Nigerian commercial bank — all reachable through standard NUBAN account numbers |
| **Incoming** | OP payment completes in Rafiki → **Paystack Transfer API** → user's linked Nigerian account |
| **Outgoing** | User authorises GNAP grant → **Paystack Charge/Debit API** → OP outgoing payment |
| **Status** | Primary corridor — runs end-to-end with real settlement |

This is the corridor that makes the project concrete. Because NUBAN is the common denominator across Nigerian banking and mobile money, **one** Paystack integration reaches the entire ecosystem. A wallet address on OpenBridge can pay out to an OPay wallet, a Kuda account, or a GTBank account with no per-provider work — they're all NUBAN destinations over NIBSS.

### Corridor 2 — United Kingdom *(built; sandbox-tested)*

| | |
|---|---|
| **PSP** | Stripe Connect (Express accounts) |
| **Rail** | Faster Payments |
| **Coverage** | UK bank accounts reachable via Faster Payments |
| **Incoming** | OP payment completes in Rafiki → **Stripe Connect payout** → user's linked UK bank account |
| **Outgoing** | User authorises GNAP grant → **Stripe Connect charge** → OP outgoing payment |
| **Status** | Built, sandbox-tested end-to-end |

### Corridor 3 — United States *(built; sandbox-tested)*

| | |
|---|---|
| **PSP** | Stripe Connect (Express accounts) |
| **Rail** | ACH |
| **Coverage** | US bank accounts reachable via ACH |
| **Incoming** | OP payment completes in Rafiki → **Stripe Connect payout** → user's linked US bank account |
| **Outgoing** | User authorises GNAP grant → **Stripe Connect charge** → OP outgoing payment |
| **Status** | Built, sandbox-tested end-to-end |

### Why these PSPs

**Paystack for Nigeria.** Its sandbox is self-serve and available immediately — no business-approval gate standing between an idea and a working test. Its Transfer API settles to any NUBAN-registered account over NIBSS, which is why a single integration covers the whole market. And Paystack is a Stripe company, so all three corridors sit under one consistent infrastructure story rather than three unrelated vendor relationships.

**Stripe Connect for UK and US.** One SDK covers both corridors — the UK corridor is a Faster Payments configuration and the US corridor is an ACH configuration of the same Connect primitives. Express-account onboarding is self-serve, the sandbox is fully testable without moving real money, and crucially: building *both* UK and US on Stripe Connect costs roughly what building *one* corridor on an unfamiliar PSP would. Engineering effort goes into the corridor abstraction, not into vendor onboarding.

## ZK account linkage

Linking a real bank account to a wallet address normally means handing the provider your account number and bank details to store. OpenBridge offers a stronger option on the Nigeria corridor: **prove you own a valid account without revealing it.**

When a user links a Nigerian account, instead of OpenBridge storing raw account details, the user's device generates a zero-knowledge proof attesting that they control a valid, KYC-verified account in good standing. OpenBridge verifies the proof; it never sees the underlying account number. What it stores is a commitment, not credentials.

### What the proof proves

The circuit proves knowledge of an `(account_number, bank_code, owner_name)` tuple such that:

1. `Poseidon2(account_number ‖ bank_code) == committed_hash` — the user knows the preimage behind a commitment OpenBridge holds.
2. The account is registered with a **licensed Nigerian financial institution** (bank code is in the attested set).
3. The **account-holder name matches** the OpenBridge user's registered identity.

…all without revealing `account_number`, `bank_code`, or `owner_name` to OpenBridge.

### How it works

| Stage | Where | What happens |
|---|---|---|
| **Circuit** | Noir (UltraHonk proving system) | The constraint system above, compiled to a verifiable circuit |
| **Hashing** | Poseidon2 | ZK-friendly hash for the account commitment |
| **Proof generation** | Client-side (user's browser/device) | Raw account details never leave the user's device |
| **Verification** | Server-side, on OpenBridge's Rafiki instance | The gateway verifies the UltraHonk proof and records only the commitment |

### Why Noir / UltraHonk

Noir is a practical, auditable circuit language and UltraHonk is a fast, modern proving system with client-side proving that fits a browser/device workflow. The choice is also deliberately consistent with the maintainer's existing ZK work — the **Shielded Token** project uses the same note-based UTXO model, Poseidon2 hashing, and UltraHonk proving stack — so this is a known, exercised toolchain, not a research bet.

The architecture is built to extend. The same machinery generalises from *account-linkage* privacy to **transaction-level privacy** and **selective compliance disclosure** — proving a transaction satisfies a policy (limits, sanctioned-list exclusion, jurisdiction) without exposing its contents — which is the direction later phases take.

## Repository structure

A pnpm/turbo-style monorepo. Each corridor is genuinely independent; the shared contract lives in `corridor-core`.

```
openbridge/
├── packages/
│   ├── rafiki-config/        Rafiki deployment config, env setup, Backend Admin
│   │                         API wiring, local Docker Compose stack
│   ├── corridor-core/        Shared Corridor interface + base types (the seam
│   │                         between protocol and settlement)
│   ├── corridor-nigeria/     Paystack integration — NUBAN/NIBSS corridor
│   ├── corridor-uk/          Stripe Connect integration — Faster Payments
│   ├── corridor-us/          Stripe Connect integration — ACH
│   ├── zk-linkage/           Noir circuit + UltraHonk proof generation/verification
│   │                         for account linkage (Poseidon2 commitments)
│   └── gateway-api/          Main API server — orchestrates Rafiki events,
│                             routes to corridors, owns user & corridor-mapping store
├── apps/
│   └── onboarding-ui/        User-facing onboarding, GNAP consent screens,
│                             wallet-address management, client-side ZK proving
└── docs/
    ├── architecture.md       System architecture & data flows
    ├── corridor-spec.md      Corridor-connector interface specification
    └── open-source-guide.md  How to fork and add your own corridor
```

## Getting started

### Prerequisites

- **Node.js ≥ 20** and **pnpm ≥ 9** — gateway, corridors, UI
- **Rust toolchain + Nargo (Noir)** — building and proving the ZK linkage circuit
- **Docker + Docker Compose** — running Rafiki, PostgreSQL, and Redis locally
- **Paystack** test/sandbox API keys (Nigeria corridor)
- **Stripe** test API keys with Connect enabled (UK/US corridors)

### Clone and install

```bash
git clone https://github.com/MarvyNwaokobia/openbridge.git
cd openbridge
pnpm install
```

### Configure environment

```bash
cp .env.example .env
```

Then fill in `.env` — Rafiki/datastore URLs, your Paystack and Stripe sandbox keys, and the ZK verifier path. Every variable is documented inline in [`.env.example`](./.env.example).

### Run Rafiki and the datastores locally

```bash
# Brings up Rafiki (backend, auth, resource), PostgreSQL, and Redis
pnpm rafiki:up

# Apply migrations and seed the asset / peering config
pnpm rafiki:migrate
pnpm rafiki:seed
```

### Build the ZK circuit

```bash
pnpm --filter zk-linkage build      # nargo compile + generate verification key
```

### Start the gateway and onboarding UI

```bash
pnpm --filter gateway-api dev       # http://localhost:4000
pnpm --filter onboarding-ui dev     # http://localhost:5173
```

### Run a test payment end to end

```bash
# 1. Issue a wallet address
pnpm cli wallet:create --username marvy --corridor NG

# 2. Link a (sandbox) Nigerian account with a ZK ownership proof
pnpm cli account:link --username marvy --corridor NG --zk

# 3. Resolve the wallet address (what a sending client sees)
curl https://openbridge.org/marvy

# 4. Drive a full Open Payments payment (grant -> quote -> incoming payment)
#    and watch the Paystack sandbox transfer fire on completion.
pnpm cli pay:demo --to '$openbridge.org/marvy' --amount 5000 --asset NGN
```

A successful run ends with a Paystack sandbox transfer to the linked account and the proof commitment recorded in Postgres — no raw account number stored anywhere.

## Roadmap

The build is sequenced corridor-first: get one corridor settling real money end to end, then generalise the pattern.

**Phase 1 — Foundation**
- [ ] Deploy Rafiki (wallet address server, GNAP auth server, OP resource server)
- [ ] Issue the first `$openbridge.org/username` wallet address
- [ ] First end-to-end test payment through Rafiki
- [ ] `gateway-api` + Postgres/Redis + local Docker stack

**Phase 2 — Nigeria corridor + ZK linkage**
- [ ] Nigeria corridor: Paystack Transfer (incoming) and Charge/Debit (outgoing)
- [ ] First real settlement into a NUBAN account from an Open Payments payment
- [ ] Onboarding UI: wallet creation, account linking, GNAP consent screens
- [ ] Noir/UltraHonk account-linkage circuit (Poseidon2 commitments)

**Phase 3 — UK + US corridors**
- [ ] UK corridor (Stripe Connect / Faster Payments), sandbox-tested
- [ ] US corridor (Stripe Connect / ACH), sandbox-tested
- [ ] ZK account linkage live on the Nigeria corridor (client-side proving, server-side verification)

**Phase 4 — Hardening & open source**
- [ ] End-to-end testing across all three corridors
- [ ] Documentation: architecture, corridor-connector spec, open-source guide
- [ ] Tagged open-source release (MIT)

## Contributing

OpenBridge is built so that **the next market is a pull request, not a rewrite.** The expensive, shared work — running Rafiki correctly, GNAP consent, quote disclosure, the event plumbing, the ZK linkage pattern — already exists. A new corridor only has to teach the gateway how to move money on one new rail.

If you're building in **Kenya (M-Pesa)**, **Ghana (MTN MoMo)**, India (UPI), the Philippines, Brazil (Pix), or anywhere a strong domestic instant-payment rail exists with no Open Payments on-ramp, you can adapt the pattern directly:

1. Fork the repo and copy `packages/corridor-nigeria` as your template.
2. Implement the `Corridor` interface from `corridor-core` against your market's PSP and rail (e.g. Safaricom Daraja for M-Pesa, MTN MoMo API for Ghana).
3. Map `settleIncoming` to a payout and `fundOutgoing` to a charge on your rail.
4. Register the corridor in `gateway-api` and add its asset config to `rafiki-config`.
5. (Optional) Adapt `zk-linkage` if your market supports a verifiable account/identity attestation.

See [`docs/corridor-spec.md`](./docs/corridor-spec.md) and [`docs/open-source-guide.md`](./docs/open-source-guide.md). Issues and PRs that add corridors, harden existing ones, or extend the ZK layer are all welcome — open an issue describing your market and rail before you start so we can help you scope it.

## License

[MIT](./LICENSE) © Marvy Nwaokobia
