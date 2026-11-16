import dns from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { AppError } from './errors.js';

const blockedAddresses = new BlockList();

const BLOCKED_IPV4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const BLOCKED_IPV6: [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

for (const [address, prefix] of BLOCKED_IPV4) blockedAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of BLOCKED_IPV6) blockedAddresses.addSubnet(address, prefix, 'ipv6');

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home'];

export function blockedTarget(detail: string): AppError {
  return new AppError(400, 'URL_NOT_ALLOWED', `Requests to ${detail} are not allowed`);
}

/** True for loopback, private, link-local, metadata and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  // BlockList also applies IPv4 rules to IPv4-mapped IPv6 addresses such as ::ffff:127.0.0.1.
  return blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    !host.includes('.') ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

function resolveAll(hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

/**
 * Rejects URLs that could reach internal infrastructure: non-http schemes, embedded
 * credentials, internal hostnames, and any name that resolves to a non-public address.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'URL_NOT_ALLOWED', 'Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw blockedTarget(`${url.protocol} URLs`);
  }
  if (url.username || url.password) throw blockedTarget('URLs with embedded credentials');

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw blockedTarget('private addresses');
    return url;
  }
  if (isBlockedHostname(hostname)) throw blockedTarget('internal hostnames');

  let addresses: LookupAddress[];
  try {
    addresses = await resolveAll(hostname);
  } catch {
    throw new AppError(400, 'URL_NOT_ALLOWED', `Could not resolve ${hostname}`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw blockedTarget('private addresses');
  }
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * DNS lookup for outgoing sockets. Checking again at connect time closes the DNS rebinding
 * gap, where a name resolves to a public address during validation and a private one after.
 */
export function publicOnlyLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      callback(blockedTarget('private addresses') as NodeJS.ErrnoException, []);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0] as LookupAddress;
    callback(null, first.address, first.family);
  });
}
