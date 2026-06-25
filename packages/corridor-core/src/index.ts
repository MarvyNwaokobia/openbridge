/**
 * OpenBridge — packages/corridor-core
 * The shared contract every corridor connector implements.
 *
 * A "corridor" maps the Open Payments payment flow onto exactly one real-world
 * payment rail (Nigeria/NUBAN via Paystack, UK/Faster Payments via Stripe,
 * US/ACH via Stripe). The gateway treats every corridor identically through the
 * `ICorridorConnector` interface below and routes by the user's linked account,
 * so adding a new market means implementing this interface once — not redesigning
 * the system.
 *
 * Built for the Interledger Open Payments Accelerator 2026.
 */

/** ISO 3166-1 alpha-2 region codes for the corridors OpenBridge supports. */
export type CorridorRegion = 'NG' | 'GB' | 'US';

/**
 * A monetary asset, expressed the Open Payments / Rafiki way: an ISO 4217
 * currency code plus a `scale` giving the number of decimal places used to
 * represent the smallest unit. Amounts are always integers in that smallest
 * unit (minor units), never floats — e.g. NGN 50.00 at scale 2 is `5000n`.
 */
export interface Asset {
  /** ISO 4217 currency code, e.g. `'NGN'`, `'GBP'`, `'USD'`. */
  readonly code: string;
  /** Number of decimal places; `2` means amounts are in minor units (kobo/pence/cents). */
  readonly scale: number;
}

/**
 * Static configuration for a corridor connector, supplied by the gateway at
 * construction time. Carries everything the connector needs to talk to its PSP
 * without reaching into global state or `process.env` itself.
 */
export interface CorridorConfig {
  /** Which region/rail this connector serves. */
  readonly region: CorridorRegion;
  /** The settlement asset this corridor pays out and debits in. */
  readonly asset: Asset;
  /** Whether the corridor is enabled at runtime (maps to ENABLE_NIGERIA etc.). */
  readonly enabled: boolean;
  /** Run against the PSP sandbox (`true`) or live environment (`false`). */
  readonly sandbox: boolean;
  /**
   * PSP credentials and endpoints. Kept as a string map so each corridor can
   * declare exactly the keys it needs (e.g. `paystackSecretKey`,
   * `stripeSecretKey`, `stripeConnectClientId`) without widening this type.
   */
  readonly credentials: Readonly<Record<string, string>>;
}

/**
 * Identifies the destination of a payout on a real-world rail. Corridors carry
 * the rail-specific account reference (NUBAN number + bank code for Nigeria, a
 * Stripe Connect account id for UK/US) without OpenBridge needing to understand
 * the rail's internals.
 */
export interface CorridorAccountRef {
  /**
   * Opaque, corridor-specific account handle. For Nigeria this is typically the
   * Paystack transfer recipient code; for UK/US it is the Stripe Connect
   * (Express) account id. Never a raw account number when ZK linkage is used.
   */
  readonly handle: string;
  /** Optional human-readable label for logs and the user's dashboard. */
  readonly label?: string;
}

/** A request to move money OUT of the network and INTO a user's real account. */
export interface PayoutRequest {
  /**
   * Idempotency key — typically the Open Payments incoming-payment id. The
   * connector MUST treat repeated calls with the same key as the same payout.
   */
  readonly idempotencyKey: string;
  /** Where the funds should land. */
  readonly destination: CorridorAccountRef;
  /** Amount to pay out, in the asset's smallest unit (minor units). */
  readonly amount: bigint;
  /** The asset of `amount`; MUST match the corridor's configured asset. */
  readonly asset: Asset;
  /** Reference shown to the recipient where the rail supports a narration. */
  readonly reference?: string;
  /** Free-form metadata persisted with the payout for reconciliation. */
  readonly metadata?: Readonly<Record<string, string>>;
}

/** The outcome of a {@link PayoutRequest}. */
export interface PayoutResult {
  /** Overall status of the payout on the rail. */
  readonly status: 'completed' | 'pending' | 'failed';
  /** The PSP/rail transaction id, when one has been assigned. */
  readonly providerReference?: string;
  /** Amount actually paid out, in minor units. */
  readonly amount: bigint;
  /** Settlement asset of `amount`. */
  readonly asset: Asset;
  /** Machine-readable failure code when `status === 'failed'`. */
  readonly failureCode?: string;
  /** Human-readable detail for logs/support when `status === 'failed'`. */
  readonly failureReason?: string;
  /** When the rail reported the payout as settled, if known (ISO 8601). */
  readonly settledAt?: string;
}

/** A request to pull money OUT of a user's real account to fund an OUTGOING payment. */
export interface DebitRequest {
  /**
   * Idempotency key — typically the Open Payments outgoing-payment id. Repeated
   * calls with the same key MUST NOT double-charge the user.
   */
  readonly idempotencyKey: string;
  /** The user's real account to debit. */
  readonly source: CorridorAccountRef;
  /** Amount to debit, in the asset's smallest unit (minor units). */
  readonly amount: bigint;
  /** The asset of `amount`; MUST match the corridor's configured asset. */
  readonly asset: Asset;
  /**
   * Proof that the user authorised this debit — the GNAP grant/access-token id
   * the gateway obtained via the interactive grant. The connector records it
   * for audit; it does not move money without it.
   */
  readonly authorizationRef: string;
  /** Free-form metadata persisted with the debit for reconciliation. */
  readonly metadata?: Readonly<Record<string, string>>;
}

/** The outcome of a {@link DebitRequest}. */
export interface DebitResult {
  /** Overall status of the debit on the rail. */
  readonly status: 'completed' | 'pending' | 'failed';
  /** The PSP/rail transaction (charge) id, when one has been assigned. */
  readonly providerReference?: string;
  /** Amount actually debited, in minor units. */
  readonly amount: bigint;
  /** Settlement asset of `amount`. */
  readonly asset: Asset;
  /** Machine-readable failure code when `status === 'failed'`. */
  readonly failureCode?: string;
  /** Human-readable detail for logs/support when `status === 'failed'`. */
  readonly failureReason?: string;
  /** When the rail reported the debit as settled, if known (ISO 8601). */
  readonly settledAt?: string;
}

/** A point-in-time balance reading from the corridor's PSP/settlement account. */
export interface BalanceResult {
  /** Available (spendable) balance in minor units. */
  readonly available: bigint;
  /** Pending/uncleared balance in minor units, where the rail distinguishes it. */
  readonly pending: bigint;
  /** The asset the balance is denominated in. */
  readonly asset: Asset;
  /** When this reading was taken (ISO 8601). */
  readonly asOf: string;
}

/** Liveness/readiness of a corridor's dependencies (PSP API, credentials). */
export interface HealthCheckResult {
  /** `true` when the corridor can serve payouts/debits right now. */
  readonly healthy: boolean;
  /** Which corridor this reading is for. */
  readonly region: CorridorRegion;
  /** Round-trip latency to the PSP in milliseconds, when measured. */
  readonly latencyMs?: number;
  /** Detail when `healthy === false` (e.g. `'paystack: 401 invalid key'`). */
  readonly detail?: string;
}

/**
 * The interface every corridor connector implements. The gateway depends only
 * on this surface, never on a concrete PSP SDK, which is what keeps corridors
 * swappable and makes "add a new market" a single-module change.
 */
export interface ICorridorConnector {
  /** The region/rail this connector serves; stable for the connector's lifetime. */
  readonly region: CorridorRegion;
  /** The settlement asset this connector operates in. */
  readonly asset: Asset;

  /**
   * Prepare the connector for use: validate config, construct the PSP client,
   * and confirm credentials are usable. Called once by the gateway at startup,
   * before any payout/debit. MUST be idempotent and MUST reject if the corridor
   * cannot be brought up (e.g. missing or invalid credentials).
   */
  initialize(): Promise<void>;

  /**
   * Move money OUT of the Open Payments network and INTO the user's real
   * account, in response to a completed incoming payment. MUST be idempotent on
   * `request.idempotencyKey`.
   *
   * @param request Destination, amount, and idempotency key for the payout.
   * @returns The rail-level outcome, including the provider reference.
   */
  payout(request: PayoutRequest): Promise<PayoutResult>;

  /**
   * Pull money OUT of the user's real account to fund an OUTGOING Open Payments
   * payment that the user authorised via a GNAP grant. MUST be idempotent on
   * `request.idempotencyKey` and MUST NOT proceed without a valid
   * `authorizationRef`.
   *
   * @param request Source account, amount, idempotency key, and authorization ref.
   * @returns The rail-level outcome, including the provider reference.
   */
  debit(request: DebitRequest): Promise<DebitResult>;

  /**
   * Read the corridor's current settlement-account balance. Used for liquidity
   * monitoring and pre-flight checks before large payouts.
   *
   * @returns Available and pending balances in the corridor's asset.
   */
  getBalance(): Promise<BalanceResult>;

  /**
   * Probe the corridor's PSP/dependencies for liveness and readiness. Cheap and
   * side-effect-free; safe to call frequently (health endpoints, schedulers).
   *
   * @returns Whether the corridor can currently serve traffic.
   */
  healthCheck(): Promise<HealthCheckResult>;
}
