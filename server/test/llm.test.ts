import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import {
  createChatModel,
  defaultModelConfig,
  supportsTemperature,
} from '../src/services/llm/llm.js';

afterEach(() => {
  vi.restoreAllMocks();
  env.DEFAULT_MODEL = 'anthropic:claude-opus-5-5';
  env.ANTHROPIC_API_KEY = undefined;
  env.OPENAI_API_KEY = undefined;
});

describe('supportsTemperature', () => {
  it('never sends temperature to Anthropic', () => {
    expect(supportsTemperature('anthropic', 'claude-opus-5-5')).toBe(false);
    expect(supportsTemperature('anthropic', 'claude-haiku-5-5')).toBe(false);
  });

  it('skips OpenAI reasoning models', () => {
    expect(supportsTemperature('openai', 'gpt-5.2')).toBe(false);
    expect(supportsTemperature('openai', 'o3')).toBe(false);
    expect(supportsTemperature('openai', 'gpt-4.1')).toBe(true);
  });

  it('sends it to Google', () => {
    expect(supportsTemperature('google', 'gemini-2.5-pro')).toBe(true);
  });
});

describe('defaultModelConfig', () => {
  it('parses provider:model', () => {
    env.DEFAULT_MODEL = 'openai:gpt-5.2';
    expect(defaultModelConfig()).toEqual({ provider: 'openai', name: 'gpt-5.2' });
  });

  it.each(['nope', 'bad:model', ':model', 'openai:'])('rejects %s', (value) => {
    env.DEFAULT_MODEL = value;
    expect(() => defaultModelConfig()).toThrow(/DEFAULT_MODEL/);
  });
});

describe('createChatModel', () => {
  it('fails clearly when the provider has no API key', async () => {
    await expect(
      createChatModel({ provider: 'anthropic', name: 'claude-opus-5-5' }, null),
    ).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED', status: 503 });
  });

  it('builds an Anthropic model that omits temperature', async () => {
    env.ANTHROPIC_API_KEY = 'test-key';
    const model = (await createChatModel(
      { provider: 'anthropic', name: 'claude-opus-5-5', temperature: 0.2 },
      null,
    )) as unknown as { _getModelInstance?: () => Promise<{ temperature?: number }> };
    expect(model).toBeDefined();
    const instance = await model._getModelInstance?.();
    expect(instance?.temperature).toBeUndefined();
  });

  it('builds an OpenAI model', async () => {
    env.OPENAI_API_KEY = 'test-key';
    await expect(
      createChatModel({ provider: 'openai', name: 'gpt-5.2' }, null),
    ).resolves.toBeDefined();
  });
});
