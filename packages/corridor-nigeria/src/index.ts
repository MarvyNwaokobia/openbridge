/**
 * OpenBridge — packages/corridor-nigeria
 * Nigeria corridor: Paystack over NUBAN / NIBSS.
 *
 * Reaches OPay, Paga, Moniepoint, GTBank, Kuda, and every Nigerian commercial
 * bank through standard NUBAN account numbers — a single Paystack integration.
 * This package is also the reference template for new corridors: copy it, swap
 * the PSP client, and re-implement the five interface methods.
 *
 * Built for the Interledger Open Payments Accelerator 2026.
 */

import type {
  Asset,
  BalanceResult,
  CorridorConfig,
  DebitRequest,
  DebitResult,
  HealthCheckResult,
  ICorridorConnector,
  PayoutRequest,
  PayoutResult,
} from '@openbridge/corridor-core';

const NGN: Asset = { code: 'NGN', scale: 2 } as const;

/**
 * Minimal shape of the Paystack client this corridor depends on. The real
 * implementation wires this to Paystack's Transfer and Charge APIs; keeping it
 * as an interface lets us unit-test the corridor without the network.
 */
export interface PaystackClient {
  createTransfer(input: {
    recipient: string;
    amount: number;
    reference: string;
    reason?: string;
  }): Promise<{ status: string; reference: string }>;
  chargeAuthorization(input: {
    authorizationCode: string;
    amount: number;
    reference: string;
  }): Promise<{ status: string; reference: string }>;
  fetchBalance(): Promise<{ available: number; pending: number }>;
  ping(): Promise<void>;
}

/** Paystack-backed Nigeria corridor. */
export class NigeriaCorridor implements ICorridorConnector {
  public readonly region = 'NG' as const;
  public readonly asset: Asset = NGN;

  readonly #config: CorridorConfig;
  #client: PaystackClient | undefined;

  /**
   * @param config Corridor configuration; `credentials.paystackSecretKey` is required.
   * @param client Optional pre-built Paystack client (used in tests). When omitted,
   *   `initialize()` constructs one from `config`.
   */
  public constructor(config: CorridorConfig, client?: PaystackClient) {
    this.#config = config;
    this.#client = client;
  }

  public async initialize(): Promise<void> {
    const secretKey = this.#config.credentials['paystackSecretKey'];
    if (secretKey === undefined || secretKey.length === 0) {
      throw new Error('corridor-nigeria: missing credentials.paystackSecretKey');
    }
    // In production: build the real Paystack client here from config (base URL +
    // secret key) and verify the key works. Stub keeps any injected test client.
    if (this.#client === undefined) {
      throw new Error('corridor-nigeria: Paystack client not yet wired (stub)');
    }
  }

  public async payout(request: PayoutRequest): Promise<PayoutResult> {
    const client = this.#requireClient();
    const result = await client.createTransfer({
      recipient: request.destination.handle,
      amount: Number(request.amount),
      reference: request.idempotencyKey,
      ...(request.reference !== undefined ? { reason: request.reference } : {}),
    });
    return {
      status: result.status === 'success' ? 'completed' : 'pending',
      providerReference: result.reference,
      amount: request.amount,
      asset: this.asset,
    };
  }

  public async debit(request: DebitRequest): Promise<DebitResult> {
    if (request.authorizationRef.length === 0) {
      throw new Error('corridor-nigeria: debit requires an authorizationRef (GNAP grant)');
    }
    const client = this.#requireClient();
    const result = await client.chargeAuthorization({
      authorizationCode: request.source.handle,
      amount: Number(request.amount),
      reference: request.idempotencyKey,
    });
    return {
      status: result.status === 'success' ? 'completed' : 'pending',
      providerReference: result.reference,
      amount: request.amount,
      asset: this.asset,
    };
  }

  public async getBalance(): Promise<BalanceResult> {
    const client = this.#requireClient();
    const { available, pending } = await client.fetchBalance();
    return {
      available: BigInt(available),
      pending: BigInt(pending),
      asset: this.asset,
      asOf: new Date().toISOString(),
    };
  }

  public async healthCheck(): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    try {
      await this.#requireClient().ping();
      return { healthy: true, region: this.region, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        healthy: false,
        region: this.region,
        detail: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  #requireClient(): PaystackClient {
    if (this.#client === undefined) {
      throw new Error('corridor-nigeria: not initialized — call initialize() first');
    }
    return this.#client;
  }
}
