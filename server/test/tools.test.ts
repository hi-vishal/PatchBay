import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { lookup } from 'node:dns';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateExpression } from '../src/services/tools/calculator.js';
import { getBuiltinTool, getBuiltinTools, htmlToText } from '../src/services/tools/index.js';
import { safeFetch, safeRequest } from '../src/utils/safeHttp.js';
import { assertPublicUrl, isPrivateAddress, publicOnlyLookup } from '../src/utils/ssrf.js';

describe('calculator', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['2 ^ 3 ^ 2', 512],
    ['-2 ^ 2', -4],
    ['2 ^ -1', 0.5],
    ['10 % 3', 1],
    ['sqrt(16) + abs(-2)', 6],
    ['max(1, 5, 3)', 5],
    ['round(pi * 100) / 100', 3.14],
    ['1.5e3 + .5', 1500.5],
    ['--3', 3],
  ])('evaluates %s', (expression, expected) => {
    expect(evaluateExpression(expression)).toBe(expected);
  });

  it.each([
    ['', /empty/],
    ['1 / 0', /finite/],
    ['2 +', /end of expression/],
    ['(1 + 2', /Expected/],
    ['1 2', /Unexpected token/],
    ['process', /Unknown name/],
    ['constructor', /Unknown name/],
    ['__proto__', /Unexpected character/],
    ['eval(1)', /Unknown function/],
    ['require(1)', /Unknown function/],
    ['require("fs")', /Unexpected character/],
    ['1; 2', /Unexpected character/],
    ['a'.repeat(501), /too long/],
    [`${'('.repeat(200)}1${')'.repeat(200)}`, /nested/],
  ])('rejects %s', (expression, message) => {
    expect(() => evaluateExpression(expression)).toThrow(message);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it.each([
    ['http://127.0.0.1/'],
    ['http://localhost:4000/'],
    ['http://foo.localhost/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://metadata.google.internal/'],
    ['http://mongo:27017/'],
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    // Alternate spellings of 127.0.0.1 that URL parsing normalizes.
    ['http://2130706433/'],
    ['http://0x7f.0.0.1/'],
    ['http://0177.0.0.1/'],
    ['file:///etc/passwd'],
    ['gopher://example.com/'],
    ['http://user:pass@example.com/'],
    ['not a url'],
  ])('blocks %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
  });

  it('allows a public IP literal', async () => {
    const url = await assertPublicUrl('https://8.8.8.8/dns');
    expect(url.hostname).toBe('8.8.8.8');
  });
});

describe('publicOnlyLookup', () => {
  it('refuses a name that resolves to a private address at connect time', async () => {
    const error = await new Promise<unknown>((resolve) => {
      publicOnlyLookup('localhost', {}, (err) => resolve(err));
    });
    expect(error).toMatchObject({ code: 'URL_NOT_ALLOWED' });
  });
});

describe('safeRequest', () => {
  let server: Server;
  let origin: string;
  let secretHeaders: Record<string, unknown> = {};

  // The test server is on localhost, so tests use guards that trust only that exact origin.
  const guards = {
    checkUrl: async (raw: string) => {
      const url = new URL(raw);
      if (url.origin !== origin && !url.hostname.startsWith('localhost')) {
        throw Object.assign(new Error('blocked'), { code: 'URL_NOT_ALLOWED' });
      }
      return url;
    },
    lookup: lookup as never,
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect-internal') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      } else if (req.url === '/redirect-loop') {
        res.writeHead(302, { location: '/redirect-loop' });
        res.end();
      } else if (req.url === '/redirect-ok') {
        res.writeHead(301, { location: '/ok' });
        res.end();
      } else if (req.url === '/cross-origin') {
        const port = (server.address() as AddressInfo).port;
        res.writeHead(302, { location: `http://localhost:${port}/capture` });
        res.end();
      } else if (req.url === '/capture') {
        secretHeaders = req.headers;
        res.end('captured');
      } else if (req.url === '/huge') {
        res.end('x'.repeat(5000));
      } else {
        res.end(`ok ${req.method}`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('blocks localhost with the default guards', async () => {
    await expect(safeRequest({ url: `${origin}/ok` })).rejects.toMatchObject({
      code: 'URL_NOT_ALLOWED',
    });
  });

  it('follows a valid redirect', async () => {
    const res = await safeRequest({ url: `${origin}/redirect-ok` }, guards);
    expect(res.body).toBe('ok GET');
    expect(res.url).toBe(`${origin}/ok`);
  });

  it('revalidates redirect targets, so a redirect cannot reach metadata endpoints', async () => {
    await expect(safeRequest({ url: `${origin}/redirect-internal` }, guards)).rejects.toMatchObject(
      { code: 'URL_NOT_ALLOWED' },
    );
  });

  it('stops redirect loops', async () => {
    await expect(safeRequest({ url: `${origin}/redirect-loop` }, guards)).rejects.toMatchObject({
      code: 'TOO_MANY_REDIRECTS',
    });
  });

  it('caps response size', async () => {
    const res = await safeRequest({ url: `${origin}/huge`, maxBytes: 100 }, guards);
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(100);
  });

  it('drops credentials when a redirect changes origin', async () => {
    await safeRequest(
      {
        url: `${origin}/cross-origin`,
        headers: { Authorization: 'Bearer secret', 'X-Keep': 'yes' },
      },
      guards,
    );
    expect(secretHeaders.authorization).toBeUndefined();
    expect(secretHeaders['x-keep']).toBe('yes');
  });

  it('ignores an attempt to override the Host header', async () => {
    const res = await safeRequest(
      { url: `${origin}/ok`, headers: { Host: 'metadata.google.internal' } },
      guards,
    );
    expect(res.status).toBe(200);
  });
});

describe('builtin tools', () => {
  it('returns only known tools', () => {
    expect(getBuiltinTools(['calculator', 'nope']).map((tool) => tool.name)).toEqual([
      'calculator',
    ]);
  });

  it('runs the calculator tool', async () => {
    expect(await getBuiltinTool('calculator')?.invoke({ expression: '6 * 7' })).toBe('42');
  });

  it('reports the current time in a zone', async () => {
    const output = await getBuiltinTool('current_time')?.invoke({ timezone: 'Asia/Kolkata' });
    expect(JSON.parse(String(output))).toMatchObject({ timezone: 'Asia/Kolkata' });
  });

  it('rejects an unknown time zone', async () => {
    await expect(
      getBuiltinTool('current_time')?.invoke({ timezone: 'Mars/Base' }),
    ).rejects.toThrow();
  });

  it('refuses internal URLs in the http_request and web_fetch tools', async () => {
    await expect(
      getBuiltinTool('http_request')?.invoke({ url: 'http://169.254.169.254/' }),
    ).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    await expect(
      getBuiltinTool('web_fetch')?.invoke({ url: 'http://localhost:4000/' }),
    ).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
  });

  it('extracts readable text from HTML', () => {
    const html = `<html><head><title>x</title><style>p{}</style></head><body>
      <script>alert(1)</script><p>Tom &amp; Jerry</p><div>A&#39;B</div></body></html>`;
    expect(htmlToText(html)).toBe("Tom & Jerry\nA'B");
  });
});

describe('safeFetch', () => {
  const allowLocal = {
    checkUrl: (url: string) => Promise.resolve(new URL(url)),
    lookup: lookup as unknown as LookupFunction,
  };

  function serve(handler: RequestListener): Promise<{ url: string; close: () => void }> {
    const server = createServer(handler);
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
      });
    });
  }

  it('refuses private addresses by default', async () => {
    await expect(safeFetch('http://127.0.0.1:9/')).rejects.toMatchObject({
      code: 'URL_NOT_ALLOWED',
    });
  });

  it('streams the body and passes the method, headers and body along', async () => {
    let seen = '';
    const target = await serve((req, res) => {
      req.on('data', (chunk: Buffer) => (seen += chunk.toString()));
      req.on('end', () => {
        res.setHeader('x-echo', String(req.headers['x-test']));
        res.write('one ');
        res.end('two');
      });
    });
    try {
      const response = await safeFetch(
        target.url,
        { method: 'POST', headers: { 'x-test': 'yes' }, body: 'payload' },
        allowLocal,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('x-echo')).toBe('yes');
      expect(await response.text()).toBe('one two');
      expect(seen).toBe('payload');
    } finally {
      target.close();
    }
  });

  it('refuses to follow a redirect', async () => {
    const target = await serve((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'http://169.254.169.254/');
      res.end();
    });
    try {
      await expect(safeFetch(target.url, {}, allowLocal)).rejects.toMatchObject({
        code: 'REDIRECT_NOT_ALLOWED',
      });
    } finally {
      target.close();
    }
  });

  it('stops when aborted', async () => {
    const target = await serve(() => undefined);
    try {
      const controller = new AbortController();
      const pending = safeFetch(target.url, { signal: controller.signal }, allowLocal);
      controller.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      target.close();
    }
  });
});
