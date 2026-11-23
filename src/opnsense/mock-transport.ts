import { stats } from '../stats.js';
import type { Transport, WireResponse } from './transport.js';

const UUID = '00000000-0000-4000-8000-000000000000';

/** Canned answers by path. Anything else gets a generic "ok" shape that the list, get and write tools can read. */
function fixture(path: string): unknown {
  if (path.includes('core/firmware/status')) return { product: { product_version: '26.1.2', product_name: 'OPNsense' }, status: 'none' };
  return { result: 'saved', status: 'ok', uuid: UUID, rows: [], rowCount: 0, total: 0, current: 1, response: {}, message: '[TEST] simulated answer' };
}

/** Test mode backend: answers from memory. Nothing here opens a connection, reads a secret, or touches a file. */
export function createMockTransport(): Transport {
  return {
    close: () => undefined,
    send: async (req): Promise<WireResponse> => {
      stats.mockRequests++;
      return { status: 200, contentType: 'application/json', body: JSON.stringify(fixture(req.label)), localAddress: '198.51.100.7', remoteAddress: '192.0.2.1' };
    },
  };
}
