import http from 'node:http';
import https from 'node:https';
import type { InstanceConfig } from '../config.js';
import { OpnsenseError } from './errors.js';
import { stats } from '../stats.js';

/**
 * THE network point of this server: no other file may open a connection (test/testmode.test.ts, proof A).
 * In test mode nothing here is ever constructed, and the guard below cuts any attempt that gets this far.
 */
export interface WireRequest {
  method: 'GET' | 'POST';
  url: URL;
  headers: Record<string, string>;
  payload?: string;
  timeoutMs: number;
  /** Open a new connection instead of a kept-alive one. */
  fresh?: boolean;
  /** Path shown in error messages. */
  label: string;
}

export interface WireResponse {
  status: number;
  contentType: string;
  body: string;
  localAddress?: string;
  remoteAddress?: string;
}

export interface Transport {
  send(req: WireRequest): Promise<WireResponse>;
  close(): void;
}

let egressBlocked = false;

/** Closes the network for the rest of the process. There is deliberately no way to reopen it. */
export function blockEgress(): void {
  egressBlocked = true;
}

export function egressError(what: string): OpnsenseError {
  stats.egressBlocked(what);
  return new OpnsenseError('egress_blocked', `TEST_MODE_EGRESS_BLOCKED: ${what} was cut, nothing left this process.`, {
    hint: 'The server runs in test mode (MCP_TEST_MODE=1 or --test): no network access is allowed. Do not retry.',
  });
}

export function createHttpTransport(config: Pick<InstanceConfig, 'url' | 'verifySsl' | 'ca'>, maxSockets: number): Transport {
  if (egressBlocked) throw egressError('creating the network transport');
  const secure = new URL(config.url).protocol === 'https:';
  const options: https.AgentOptions = { keepAlive: true, maxSockets };
  if (secure) {
    options.rejectUnauthorized = config.verifySsl;
    if (config.ca) options.ca = config.ca;
  }
  const agent = secure ? new https.Agent(options) : new http.Agent(options);
  return {
    close: () => agent.destroy(),
    send: (r) => {
      if (egressBlocked) return Promise.reject(egressError(`${r.method} ${r.label}`));
      const oneShot = r.fresh ? (secure ? new https.Agent({ ...options, keepAlive: false }) : new http.Agent({ ...options, keepAlive: false })) : undefined;
      return new Promise<WireResponse>((resolve, reject) => {
        const req = (secure ? https : http).request(r.url, { method: r.method, headers: r.headers, agent: oneShot ?? agent }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () => {
            const socket = res.socket;
            resolve({
              status: res.statusCode ?? 0,
              contentType: String(res.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks).toString('utf8'),
              ...(socket?.localAddress ? { localAddress: socket.localAddress } : {}),
              ...(socket?.remoteAddress ? { remoteAddress: socket.remoteAddress } : {}),
            });
          });
        });
        req.setTimeout(r.timeoutMs, () => {
          req.destroy(new OpnsenseError('timeout', `The firewall did not answer ${r.label} within ${Math.round(r.timeoutMs / 1000)} s.`, {
            hint: 'If a firewall change was just applied, it may have cut this connection: see opn_pending_changes.',
          }));
        });
        req.on('error', reject);
        req.on('close', () => oneShot?.destroy());
        if (r.payload !== undefined) req.write(r.payload);
        req.end();
      });
    },
  };
}
