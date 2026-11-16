import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAICompletions } from '@langchain/openai';
import { initChatModel } from 'langchain/chat_models/universal';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { LlmSettingsDoc } from '../../models/LlmSettings.js';
import { LlmSettings } from '../../models/LlmSettings.js';
import type { LlmProvider } from '../../models/shared.js';
import { LLM_PROVIDERS } from '../../models/shared.js';
import { decryptJson } from '../../utils/crypto.js';
import { AppError, serviceUnavailable } from '../../utils/errors.js';
import { safeFetch } from '../../utils/safeHttp.js';
import type { ModelDetail, OllamaTarget } from './catalog.js';
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_FREE_ROUTER,
  inspectOllama,
  isFreeOpenRouterModel,
  listOpenRouterFreeModels,
  normalizeOllamaUrl,
} from './catalog.js';

export interface ModelConfig {
  provider: LlmProvider;
  name: string;
  temperature?: number;
}

type OwnerId = Types.ObjectId;
type KeyedProvider = Exclude<LlmProvider, 'ollama'>;
export type KeySource = 'user' | 'server';

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

const LANGCHAIN_PROVIDER: Record<Exclude<KeyedProvider, 'openrouter'>, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google-genai',
};

/** Suggestions for the UI. Any model id the provider accepts can be typed in instead. */
const SUGGESTED_MODELS: Record<LlmProvider, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  openai: ['gpt-5.2', 'gpt-5-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  openrouter: [OPENROUTER_FREE_ROUTER],
  ollama: [],
};

/** Order for picking a default when the configured one cannot run. Free options come first. */
const FALLBACK_ORDER: LlmProvider[] = ['openrouter', 'anthropic', 'openai', 'google', 'ollama'];

/** Ollama needs no key, but the OpenAI client refuses to start without one. */
const OLLAMA_PLACEHOLDER_KEY = 'ollama';

function serverKey(provider: KeyedProvider): string | undefined {
  const keys: Record<KeyedProvider, string | undefined> = {
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    google: env.GOOGLE_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
  };
  return keys[provider];
}

function credentialFor(settings: LlmSettingsDoc | null, provider: LlmProvider) {
  return settings?.credentials.find((item) => item.provider === provider);
}

/** A person's own key wins over the deployment's. */
function resolveKey(
  settings: LlmSettingsDoc | null,
  provider: KeyedProvider,
): { apiKey: string; source: KeySource } | undefined {
  const encrypted = credentialFor(settings, provider)?.encryptedKey;
  if (encrypted) {
    try {
      return { apiKey: decryptJson<string>(encrypted), source: 'user' };
    } catch {
      throw new AppError(
        500,
        'LLM_KEY_UNREADABLE',
        `Your ${PROVIDER_LABELS[provider]} key can no longer be read. Add it again in Settings.`,
      );
    }
  }
  const apiKey = serverKey(provider);
  return apiKey ? { apiKey, source: 'server' } : undefined;
}

/** A person's own Ollama address wins over the deployment's. */
export function resolveOllamaTarget(settings: LlmSettingsDoc | null): OllamaTarget | undefined {
  if (settings?.ollamaBaseUrl) {
    return { baseUrl: normalizeOllamaUrl(settings.ollamaBaseUrl), trusted: false };
  }
  return env.OLLAMA_BASE_URL
    ? { baseUrl: normalizeOllamaUrl(env.OLLAMA_BASE_URL), trusted: true }
    : undefined;
}

function hasAccess(settings: LlmSettingsDoc | null, provider: LlmProvider): boolean {
  if (provider === 'ollama') return Boolean(resolveOllamaTarget(settings));
  return Boolean(credentialFor(settings, provider)?.encryptedKey ?? serverKey(provider));
}

/**
 * Current Anthropic models return a 400 for any `temperature`, and OpenAI's reasoning models
 * accept only the default. Sending it only where it works keeps a saved agent setting from
 * failing every request.
 */
export function supportsTemperature(provider: LlmProvider, model: string): boolean {
  if (provider === 'anthropic') return false;
  if (provider === 'openai') return !/^(o\d|gpt-5)/.test(model);
  return true;
}

/** Parses DEFAULT_MODEL, formatted provider:model. */
export function defaultModelConfig(): ModelConfig {
  const separator = env.DEFAULT_MODEL.indexOf(':');
  const provider = env.DEFAULT_MODEL.slice(0, separator) as LlmProvider;
  const name = env.DEFAULT_MODEL.slice(separator + 1);
  if (separator < 1 || !name || !LLM_PROVIDERS.includes(provider)) {
    throw new AppError(
      500,
      'INVALID_DEFAULT_MODEL',
      `DEFAULT_MODEL must look like provider:model, with provider one of ${LLM_PROVIDERS.join(', ')}`,
    );
  }
  return { provider, name };
}

function pickDefaultModel(settings: LlmSettingsDoc | null): ModelConfig {
  if (settings?.defaultModel) {
    return { provider: settings.defaultModel.provider, name: settings.defaultModel.name };
  }
  const configured = defaultModelConfig();
  if (hasAccess(settings, configured.provider)) return configured;

  for (const provider of FALLBACK_ORDER) {
    const name = credentialFor(settings, provider)?.modelName ?? SUGGESTED_MODELS[provider][0];
    if (name && hasAccess(settings, provider)) return { provider, name };
  }
  // Nothing can run. Using this one lets createChatModel report what to set up.
  return configured;
}

/** The person's chosen default, else the deployment's, else the first provider that can run. */
export async function resolveDefaultModel(ownerId: OwnerId): Promise<ModelConfig> {
  return pickDefaultModel(await LlmSettings.findOne({ ownerId }));
}

/** Ollama and OpenRouter both speak the OpenAI chat completions API. */
function openAiCompatibleModel(options: {
  config: ModelConfig;
  apiKey: string;
  baseURL: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}): BaseChatModel {
  const { config, apiKey, baseURL, headers, fetch: customFetch } = options;
  return new ChatOpenAICompletions({
    model: config.name,
    apiKey,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    // Free models often answer 429. Waiting out six retries would look like a hang.
    maxRetries: 2,
    configuration: {
      baseURL,
      ...(headers ? { defaultHeaders: headers } : {}),
      ...(customFetch ? { fetch: customFetch } : {}),
    },
  }) as unknown as BaseChatModel;
}

function createOllamaModel(config: ModelConfig, settings: LlmSettingsDoc | null): BaseChatModel {
  const target = resolveOllamaTarget(settings);
  if (!target) {
    throw serviceUnavailable(
      'LLM_NOT_CONFIGURED',
      'Ollama is not set up yet. Open the Ollama guide in Settings.',
    );
  }
  return openAiCompatibleModel({
    config,
    apiKey: OLLAMA_PLACEHOLDER_KEY,
    baseURL: `${target.baseUrl}/v1`,
    // An address from Settings is user input, so every connection goes through the SSRF checks.
    ...(target.trusted ? {} : { fetch: (input, init) => safeFetch(input, init) }),
  });
}

/**
 * Builds a chat model using the owner's saved key or address when they have one. Pass null only
 * where no user is involved.
 */
export async function createChatModel(
  config: ModelConfig,
  ownerId: OwnerId | null,
): Promise<BaseChatModel> {
  const settings = ownerId ? await LlmSettings.findOne({ ownerId }) : null;
  if (config.provider === 'ollama') return createOllamaModel(config, settings);

  const access = resolveKey(settings, config.provider);
  if (!access) {
    throw serviceUnavailable(
      'LLM_NOT_CONFIGURED',
      `No API key is set for ${PROVIDER_LABELS[config.provider]}. Add one in Settings, or pick another provider.`,
    );
  }

  if (config.provider === 'openrouter') {
    // The deployment's key is shared, so it must not pay for one person's choice of model.
    if (access.source === 'server' && !(await isFreeOpenRouterModel(config.name))) {
      throw new AppError(
        403,
        'MODEL_NOT_FREE',
        `${config.name} is not free on OpenRouter. Pick a free model, or add your own OpenRouter key in Settings.`,
      );
    }
    return openAiCompatibleModel({
      config,
      apiKey: access.apiKey,
      baseURL: OPENROUTER_BASE_URL,
      headers: { 'X-Title': 'Patchbay' },
    });
  }

  const model = await initChatModel(config.name, {
    modelProvider: LANGCHAIN_PROVIDER[config.provider],
    apiKey: access.apiKey,
    ...(config.temperature !== undefined && supportsTemperature(config.provider, config.name)
      ? { temperature: config.temperature }
      : {}),
    // Responses are always streamed here, so a high ceiling cannot hit an HTTP timeout.
    ...(config.provider === 'anthropic' ? { maxTokens: 64_000 } : {}),
  });
  return model as unknown as BaseChatModel;
}

export interface ProviderInfo {
  provider: LlmProvider;
  configured: boolean;
  keySource: KeySource | null;
  /** True when only free models will run: OpenRouter on the deployment's shared key. */
  freeOnly: boolean;
  models: string[];
  modelDetails?: ModelDetail[];
  supportsTemperature: boolean;
}

/** The person's saved model name goes first, so choosing the provider selects it. */
function withSavedModel(saved: string | null | undefined, models: string[]): string[] {
  return [...new Set([...(saved ? [saved] : []), ...models])];
}

async function describeOpenRouter(settings: LlmSettingsDoc | null): Promise<ProviderInfo> {
  const credential = credentialFor(settings, 'openrouter');
  const hasOwnKey = Boolean(credential?.encryptedKey);
  const configured = hasOwnKey || Boolean(env.OPENROUTER_API_KEY);
  const modelDetails = await listOpenRouterFreeModels();
  const freeIds = modelDetails.map((model) => model.id);
  // On the shared key a paid model would be refused, so it is not offered.
  const saved = credential?.modelName;
  const savedUsable = hasOwnKey || saved?.endsWith(':free') || freeIds.includes(saved ?? '');
  return {
    provider: 'openrouter',
    configured,
    keySource: hasOwnKey ? 'user' : configured ? 'server' : null,
    freeOnly: !hasOwnKey,
    models: withSavedModel(savedUsable ? saved : null, freeIds),
    modelDetails,
    supportsTemperature: true,
  };
}

async function describeOllama(settings: LlmSettingsDoc | null): Promise<ProviderInfo> {
  const target = resolveOllamaTarget(settings);
  const status = target ? await inspectOllama(target) : { reachable: false, models: [] };
  return {
    provider: 'ollama',
    // Without an installed model there is nothing to chat with yet.
    configured: status.reachable && status.models.length > 0,
    keySource: null,
    freeOnly: false,
    models: withSavedModel(credentialFor(settings, 'ollama')?.modelName, status.models),
    supportsTemperature: true,
  };
}

function describeKeyed(
  settings: LlmSettingsDoc | null,
  provider: Exclude<KeyedProvider, 'openrouter'>,
): ProviderInfo {
  const credential = credentialFor(settings, provider);
  const hasOwnKey = Boolean(credential?.encryptedKey);
  const configured = hasOwnKey || Boolean(serverKey(provider));
  return {
    provider,
    configured,
    keySource: hasOwnKey ? 'user' : configured ? 'server' : null,
    freeOnly: false,
    models: withSavedModel(credential?.modelName, SUGGESTED_MODELS[provider]),
    supportsTemperature: provider !== 'anthropic',
  };
}

export async function listProviders(ownerId: OwnerId): Promise<ProviderInfo[]> {
  const settings = await LlmSettings.findOne({ ownerId });
  const [openrouter, ollama] = await Promise.all([
    describeOpenRouter(settings),
    describeOllama(settings),
  ]);
  return [
    describeKeyed(settings, 'anthropic'),
    describeKeyed(settings, 'openai'),
    describeKeyed(settings, 'google'),
    openrouter,
    ollama,
  ];
}
