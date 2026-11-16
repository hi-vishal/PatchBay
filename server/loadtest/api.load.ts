import type { AddressInfo } from 'node:net';
import autocannon from 'autocannon';
import { describe, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Agent } from '../src/models/index.js';
import { useAiTestEnvironment } from '../test/helpers/aiEnv.js';
import { createUser } from '../test/helpers/auth.js';

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('../test/helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

useAiTestEnvironment();

const SECONDS = Number(process.env.LOAD_SECONDS ?? 10);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 200);

/**
 * Measures one API process on this machine, with an in-memory MongoDB and sign-in checks stubbed.
 * It shows what the Express and Mongoose layers cost. It does not measure a real database over a
 * network, token verification, or a model provider, and those are slower.
 */
describe('API throughput, one process', () => {
  it(`holds ${CONNECTIONS} connections for ${SECONDS}s per route`, async () => {
    const owner = await createUser('load');
    await Agent.insertMany(
      Array.from({ length: 5 }, (_, index) => ({
        ownerId: owner._id,
        name: `Agent ${index}`,
        systemPrompt: 'Answer briefly.',
        model: { provider: 'openrouter' as const, name: 'example/model' },
      })),
    );

    const server = createApp().listen(0);
    const { port } = server.address() as AddressInfo;
    const auth = { Authorization: 'Bearer test:load' };
    const routes = [
      { name: 'health (no database)', path: '/api/health', headers: {} },
      { name: 'public plan list', path: '/api/billing/plans', headers: {} },
      { name: 'signed-in: account and usage', path: '/api/me', headers: auth },
      { name: 'signed-in: list agents', path: '/api/agents', headers: auth },
    ];

    const rows: Record<string, string | number>[] = [];
    for (const route of routes) {
      const result = await autocannon({
        url: `http://127.0.0.1:${port}${route.path}`,
        connections: CONNECTIONS,
        duration: SECONDS,
        headers: route.headers,
      });
      rows.push({
        route: route.name,
        'requests/s': Math.round(result.requests.average),
        'p50 ms': result.latency.p50,
        'p99 ms': result.latency.p99,
        'not 2xx': result.non2xx,
        errors: result.errors + result.timeouts,
      });
    }
    await new Promise((resolve) => server.close(resolve));

    // Written straight to the terminal, because the test runner holds console output back.
    const lines = rows.map((row) =>
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' | '),
    );
    process.stdout.write(
      `\n${CONNECTIONS} connections, ${SECONDS}s per route, one process:\n${lines.join('\n')}\n`,
    );
  });
});
