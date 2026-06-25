/**
 * OpenBridge — packages/gateway-api
 * Main API server: orchestrates Rafiki events, routes payment lifecycle events
 * to corridor connectors, owns the user + corridor-mapping store, and verifies
 * ZK account-linkage proofs.
 *
 * This entry point is a minimal, dependency-free HTTP server scaffold. Routes
 * are placeholders to be filled in as the gateway is built out; the corridor
 * registry below shows how connectors are wired in behind the ICorridorConnector
 * interface.
 *
 * Built for the Interledger Open Payments Accelerator 2026.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { CorridorRegion, ICorridorConnector } from '@openbridge/corridor-core';

const PORT: number = Number(process.env['GATEWAY_PORT'] ?? 4000);

/**
 * Corridor registry. Connectors are registered here keyed by region; the gateway
 * routes each Rafiki payment event to a corridor by the user's linked account.
 * Connectors are constructed and `initialize()`d at startup (omitted in this
 * scaffold until PSP credentials are wired).
 */
const corridors = new Map<CorridorRegion, ICorridorConnector>();

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    json(res, 200, {
      status: 'ok',
      service: 'openbridge-gateway',
      corridors: [...corridors.keys()],
    });
    return;
  }

  // Rafiki posts payment lifecycle events here; the gateway routes them to the
  // right corridor's payout()/debit(). Implementation pending.
  if (method === 'POST' && url === '/webhooks/rafiki') {
    json(res, 202, { received: true });
    return;
  }

  json(res, 404, { error: 'not_found' });
}

const server = createServer(handle);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`OpenBridge gateway listening on http://localhost:${PORT}`);
});

export { server };
