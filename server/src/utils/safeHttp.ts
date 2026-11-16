import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { AppError } from './errors.js';
import { assertPublicUrl, publicOnlyLookup } from './ssrf.js';

export interface SafeRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

/** The URL check and DNS lookup can be swapped so tests can exercise redirects on localhost. */
export interface SafeRequestGuards {
  checkUrl?: (url: string) => Promise<URL>;
  lookup?: LookupFunction;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FORBIDDEN_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'te',
  'trailer',
]);
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'api-key']);

function cleanHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !FORBIDDEN_HEADERS.has(name.toLowerCase())),
  );
}

function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())),
  );
}

interface Hop {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  truncated: boolean;
}

function sendOnce(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  maxBytes: number,
  lookup: LookupFunction,
): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method,
        headers: { 'user-agent': 'ai-automation-platform/0.1', ...headers },
        lookup,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = (truncated: boolean) =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
          });

        response.on('data', (chunk: Buffer) => {
          const room = maxBytes - size;
          chunks.push(chunk.subarray(0, Math.max(room, 0)));
          size += chunk.length;
          if (size > maxBytes) {
            finish(true);
            response.destroy();
          }
        });
        response.on('end', () => finish(false));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/**
 * HTTP client for URLs supplied by users or models. Every hop is validated, including
 * redirects, and the socket refuses non-public addresses. Responses are capped in time and size.
 */
export async function safeRequest(
  input: SafeRequestInput,
  guards: SafeRequestGuards = {},
): Promise<SafeResponse> {
  const checkUrl = guards.checkUrl ?? assertPublicUrl;
  const lookup = guards.lookup ?? (publicOnlyLookup as unknown as LookupFunction);
  const timeoutMs = input.timeoutMs ?? 15_000;
  const maxBytes = input.maxBytes ?? 1_000_000;

  let url = await checkUrl(input.url);
  let method = (input.method ?? 'GET').toUpperCase();
  let body = input.body;
  let headers = cleanHeaders(input.headers);

  for (let redirects = 0; ; redirects += 1) {
    const hop = await sendOnce(url, method, headers, body, timeoutMs, maxBytes, lookup);
    const location = hop.headers.location;

    if (!REDIRECT_STATUSES.has(hop.status) || !location) {
      return {
        status: hop.status,
        url: url.toString(),
        headers: Object.fromEntries(
          Object.entries(hop.headers).map(([name, value]) => [name, String(value)]),
        ),
        body: hop.body,
        truncated: hop.truncated,
      };
    }
    if (redirects >= MAX_REDIRECTS) {
      throw new AppError(502, 'TOO_MANY_REDIRECTS', 'Too many redirects');
    }

    const next = await checkUrl(new URL(location, url).toString());
    if (next.origin !== url.origin) headers = withoutCredentials(headers);
    if (hop.status === 303 || ((hop.status === 301 || hop.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
    url = next;
  }
}

/**
 * A fetch for clients that stream from a user-supplied address, such as the OpenAI SDK. It applies
 * the same URL and socket checks as safeRequest. Redirects are refused, because the SDK would
 * resend the prompt and any credentials to wherever they point.
 */
export async function safeFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  guards: SafeRequestGuards = {},
): Promise<Response> {
  const checkUrl = guards.checkUrl ?? assertPublicUrl;
  const lookup = guards.lookup ?? (publicOnlyLookup as unknown as LookupFunction);
  const url = await checkUrl(input instanceof Request ? input.url : input.toString());
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
    throw new AppError(500, 'UNSUPPORTED_BODY', 'safeFetch only sends string bodies');
  }

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: init.method ?? 'GET',
        // Node's http client does not decompress, so ask for a plain response.
        headers: {
          ...cleanHeaders(Object.fromEntries(new Headers(init.headers).entries())),
          'accept-encoding': 'identity',
        },
        lookup,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (response) => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new AppError(502, 'REDIRECT_NOT_ALLOWED', 'This address tried to redirect'));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers.set(name, String(value));
        }
        const hasBody = status !== 204 && status !== 205;
        resolve(
          new Response(hasBody ? (Readable.toWeb(response) as ReadableStream) : null, {
            status,
            headers,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(init.body ?? undefined);
  });
}
