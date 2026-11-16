import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson } from '../src/utils/crypto.js';

describe('crypto', () => {
  const secret = { bearerToken: 'super-secret', headers: { 'X-Key': 'abc' } };

  it('round-trips JSON', () => {
    expect(decryptJson(encryptJson(secret))).toEqual(secret);
  });

  it('does not contain the plaintext', () => {
    const payload = encryptJson(secret);
    expect(payload).not.toContain('super-secret');
    expect(Buffer.from(payload.split(':')[3] ?? '', 'base64').toString()).not.toContain('super');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptJson(secret)).not.toBe(encryptJson(secret));
  });

  it('rejects tampered ciphertext', () => {
    const [version, iv, tag, ciphertext] = encryptJson(secret).split(':') as [
      string,
      string,
      string,
      string,
    ];
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const tampered = [version, iv, tag, bytes.toString('base64')].join(':');
    expect(() => decryptJson(tampered)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const [version, iv, , ciphertext] = encryptJson(secret).split(':') as [
      string,
      string,
      string,
      string,
    ];
    const tampered = [version, iv, Buffer.alloc(16).toString('base64'), ciphertext].join(':');
    expect(() => decryptJson(tampered)).toThrow();
  });

  it('rejects an unknown format', () => {
    expect(() => decryptJson('plaintext')).toThrow(/format/);
  });
});
