import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;

function key(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'base64');
}

/** Encrypts a JSON value. Format: v1:<iv>:<auth tag>:<ciphertext>, each part base64. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Decrypts a value from encryptJson. Throws if the data was tampered with or the key differs. */
export function decryptJson<T>(payload: string): T {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('Unrecognized encrypted payload format');
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
