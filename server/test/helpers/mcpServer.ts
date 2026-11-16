import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer as McpProtocolServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export interface TestMcpServer {
  url: string;
  /** Authorization headers received so far. */
  authHeaders: (string | undefined)[];
  stop: () => Promise<void>;
}

/** Runs a real MCP server over streamable HTTP on localhost, using the official SDK. */
export async function startTestMcpServer(): Promise<TestMcpServer> {
  const authHeaders: (string | undefined)[] = [];

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    authHeaders.push(req.headers.authorization);

    const server = new McpProtocolServer({ name: 'test-tools', version: '1.0.0' });
    server.registerTool(
      'add',
      {
        description: 'Add two numbers',
        inputSchema: { a: z.number(), b: z.number() },
      },
      ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
    );
    server.registerTool('explode', { description: 'Always fails', inputSchema: {} }, () => {
      throw new Error('kaboom');
    });

    // Stateless mode: each HTTP request gets its own server and transport.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };

  const http: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));

  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    authHeaders,
    stop: () =>
      new Promise((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
