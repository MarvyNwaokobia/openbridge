/**
 * OpenBridge — packages/corridor-us
 * US corridor: Stripe Connect (Express accounts) over ACH.
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
import type { StripeConnectClient } from '@openbridge/corridor-uk';

const USD: Asset = { code: 'USD', scale: 2 } as const;

/** Stripe-Connect-backed US corridor (ACH). Shares the Stripe client with the UK corridor. */
export class UsCorridor implements ICorridorConnector {
  public readonly region = 'US' as const;
  public readonly asset: Asset = USD;

  readonly #config: CorridorConfig;
  #client: StripeConnectClient | undefined;

  public constructor(config: CorridorConfig, client?: StripeConnectClient) {
    this.#config = config;
    this.#client = client;
  }

  public async initialize(): Promise<void> {
    const secretKey = this.#config.credentials['stripeSecretKey'];
    if (secretKey === undefined || secretKey.length === 0) {
      throw new Error('corridor-us: missing credentials.stripeSecretKey');
    }
    if (this.#client === undefined) {
      throw new Error('corridor-us: Stripe Connect client not yet wired (stub)');
    }
  }

  public async payout(request: PayoutRequest): Promise<PayoutResult> {
    const result = await this.#requireClient().createPayout({
      connectedAccount: request.destination.handle,
      amount: Number(request.amount),
      currency: this.asset.code.toLowerCase(),
      idempotencyKey: request.idempotencyKey,
      method: 'standard', // ACH
    });
    return {
      status: result.status === 'paid' ? 'completed' : 'pending',
      providerReference: result.id,
      amount: request.amount,
      asset: this.asset,
    };
  }

  public async debit(request: DebitRequest): Promise<DebitResult> {
    if (request.authorizationRef.length === 0) {
      throw new Error('corridor-us: debit requires an authorizationRef (GNAP grant)');
    }
    const result = await this.#requireClient().createCharge({
      connectedAccount: request.source.handle,
      amount: Number(request.amount),
      currency: this.asset.code.toLowerCase(),
      idempotencyKey: request.idempotencyKey,
    });
    return {
      status: result.status === 'succeeded' ? 'completed' : 'pending',
      providerReference: result.id,
      amount: request.amount,
      asset: this.asset,
    };
  }

  public async getBalance(): Promise<BalanceResult> {
    const { available, pending } = await this.#requireClient().retrieveBalance(
      this.asset.code.toLowerCase(),
    );
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

  #requireClient(): StripeConnectClient {
    if (this.#client === undefined) {
      throw new Error('corridor-us: not initialized — call initialize() first');
    }
    return this.#client;
  }
}
