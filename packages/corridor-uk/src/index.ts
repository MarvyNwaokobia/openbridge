/**
 * OpenBridge — packages/corridor-uk
 * UK corridor: Stripe Connect (Express accounts) over Faster Payments.
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

const GBP: Asset = { code: 'GBP', scale: 2 } as const;

/** Minimal Stripe Connect surface shared by the UK and US corridors. */
export interface StripeConnectClient {
  createPayout(input: {
    connectedAccount: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    method: 'standard' | 'instant';
  }): Promise<{ status: string; id: string }>;
  createCharge(input: {
    connectedAccount: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ status: string; id: string }>;
  retrieveBalance(currency: string): Promise<{ available: number; pending: number }>;
  ping(): Promise<void>;
}

/** Stripe-Connect-backed UK corridor (Faster Payments). */
export class UkCorridor implements ICorridorConnector {
  public readonly region = 'GB' as const;
  public readonly asset: Asset = GBP;

  readonly #config: CorridorConfig;
  #client: StripeConnectClient | undefined;

  public constructor(config: CorridorConfig, client?: StripeConnectClient) {
    this.#config = config;
    this.#client = client;
  }

  public async initialize(): Promise<void> {
    const secretKey = this.#config.credentials['stripeSecretKey'];
    if (secretKey === undefined || secretKey.length === 0) {
      throw new Error('corridor-uk: missing credentials.stripeSecretKey');
    }
    if (this.#client === undefined) {
      throw new Error('corridor-uk: Stripe Connect client not yet wired (stub)');
    }
  }

  public async payout(request: PayoutRequest): Promise<PayoutResult> {
    const result = await this.#requireClient().createPayout({
      connectedAccount: request.destination.handle,
      amount: Number(request.amount),
      currency: this.asset.code.toLowerCase(),
      idempotencyKey: request.idempotencyKey,
      method: 'standard', // Faster Payments
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
      throw new Error('corridor-uk: debit requires an authorizationRef (GNAP grant)');
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
      throw new Error('corridor-uk: not initialized — call initialize() first');
    }
    return this.#client;
  }
}
