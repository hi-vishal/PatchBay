import { afterEach, describe, expect, it, vi } from 'vitest';

function loadEnvWithKey(keyId: string) {
  vi.resetModules();
  vi.stubEnv('RAZORPAY_KEY_ID', keyId);
  return import('../src/config/env.js');
}

describe('Razorpay test mode only', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses to start with a live key, naming the variable but not its value', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as () => never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(loadEnvWithKey('rzp_live_abc123')).rejects.toThrow('exited');

    expect(exit).toHaveBeenCalledWith(1);
    const output = stderr.mock.calls.join('');
    expect(output).toContain('RAZORPAY_KEY_ID');
    expect(output).not.toContain('rzp_live_abc123');
  });

  it('accepts a test key', async () => {
    const { env } = await loadEnvWithKey('rzp_test_abc123');
    expect(env.RAZORPAY_KEY_ID).toBe('rzp_test_abc123');
  });

  it('treats an empty placeholder as billing being off', async () => {
    const { env } = await loadEnvWithKey('');
    expect(env.RAZORPAY_KEY_ID).toBeUndefined();
  });
});
