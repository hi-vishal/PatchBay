import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { z } from 'zod';
import { errorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { SafeRequestGuards } from '../../utils/safeHttp.js';
import { safeRequest } from '../../utils/safeHttp.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** OpenRouter's own router. It picks a free model that can serve the request. */
export const OPENROUTER_FREE_ROUTER = 'openrouter/free';

const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_TIMEOUT_MS = 5_000;
const OLLAMA_TIMEOUT_MS = 3_000;

export interface ModelDetail {
  id: string;
  label: string;
  supportsTools: boolean;
}

const FALLBACK_FREE_MODELS: ModelDetail[] = [
  { id: OPENROUTER_FREE_ROUTER, label: 'Best free model (auto)', supportsTools: true },
];

const openRouterResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      pricing: z.object({ prompt: z.string(), completion: z.string() }).partial().optional(),
      architecture: z
        .object({
          input_modalities: z.array(z.string()).optional(),
          output_modalities: z.array(z.string()).optional(),
        })
        .optional(),
      supported_parameters: z.array(z.string()).optional(),
    }),
  ),
});

type OpenRouterModel = z.infer<typeof openRouterResponse>['data'][number];

/** Free models that only classify text, which would answer a chat with labels like "safe". */
const NOT_FOR_CHAT = /content-safety|guard/i;

function isFreeChatModel(model: OpenRouterModel): boolean {
  // OpenRouter sends prices as strings, and "-1" for routers whose price varies.
  const free = model.pricing?.prompt === '0' && model.pricing.completion === '0';
  const { input_modalities: input, output_modalities: output } = model.architecture ?? {};
  // Music and image models list text among their outputs too, so text must be the only one.
  const textOnly = output ? output.length > 0 && output.every((kind) => kind === 'text') : true;
  return free && textOnly && (input?.includes('text') ?? true) && !NOT_FOR_CHAT.test(model.id);
}

function toDetail(model: OpenRouterModel): ModelDetail {
  return {
    id: model.id,
    label:
      model.id === OPENROUTER_FREE_ROUTER
        ? 'Best free model (auto)'
        : (model.name?.replace(/\s*\(free\)$/i, '') ?? model.id),
    supportsTools: model.supported_parameters?.includes('tools') ?? false,
  };
}

let freeModelCache: { fetchedAt: number; models: ModelDetail[] } | undefined;

export function clearFreeModelCache(): void {
  freeModelCache = undefined;
}

/** OpenRouter's free chat models, live. The list needs no key and changes often, so it is cached. */
export async function listOpenRouterFreeModels(): Promise<ModelDetail[]> {
  if (freeModelCache && Date.now() - freeModelCache.fetchedAt < CATALOG_TTL_MS) {
    return freeModelCache.models;
  }
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
    const { data } = openRouterResponse.parse(await response.json());
    const models = data
      .filter(isFreeChatModel)
      .map(toDetail)
      .sort((a, b) => {
        if (a.id === OPENROUTER_FREE_ROUTER) return -1;
        if (b.id === OPENROUTER_FREE_ROUTER) return 1;
        return a.label.localeCompare(b.label);
      });
    if (models.length === 0) throw new Error('OpenRouter listed no free models');
    freeModelCache = { fetchedAt: Date.now(), models };
    return models;
  } catch (error) {
    logger.warn({ error: errorMessage(error) }, 'Could not load OpenRouter free models');
    return freeModelCache?.models ?? FALLBACK_FREE_MODELS;
  }
}

/** The ":free" suffix always means free, so that check still works when the list cannot load. */
export async function isFreeOpenRouterModel(name: string): Promise<boolean> {
  if (name.endsWith(':free')) return true;
  return (await listOpenRouterFreeModels()).some((model) => model.id === name);
}

/** Where to find Ollama. Only a URL from the server's own config may reach private addresses. */
export interface OllamaTarget {
  baseUrl: string;
  trusted: boolean;
}

export interface OllamaStatus {
  reachable: boolean;
  models: string[];
  error?: string;
}

const TRUSTED_GUARDS: SafeRequestGuards = {
  checkUrl: (url) => Promise.resolve(new URL(url)),
  lookup: dns.lookup as unknown as LookupFunction,
};

const ollamaTags = z.object({ models: z.array(z.object({ name: z.string() })) });

/** Accepts what people paste: a trailing slash or the /v1 and /api paths of Ollama's own URLs. */
export function normalizeOllamaUrl(raw: string): string {
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(v1|api)$/, '');
  return `${url.origin}${path}`;
}

/** Lists installed models, which also shows whether Ollama can be reached. */
export async function inspectOllama(target: OllamaTarget): Promise<OllamaStatus> {
  try {
    const response = await safeRequest(
      {
        url: `${target.baseUrl}/api/tags`,
        timeoutMs: OLLAMA_TIMEOUT_MS,
        maxBytes: 2_000_000,
      },
      target.trusted ? TRUSTED_GUARDS : {},
    );
    if (response.status !== 200) {
      return {
        reachable: false,
        models: [],
        error: `That address answered with status ${response.status}.`,
      };
    }
    const parsed = ollamaTags.safeParse(JSON.parse(response.body));
    if (!parsed.success) {
      return { reachable: false, models: [], error: 'That address does not look like Ollama.' };
    }
    return { reachable: true, models: parsed.data.models.map((model) => model.name) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { reachable: false, models: [], error: 'That address does not look like Ollama.' };
    }
    return {
      reachable: false,
      models: [],
      error: 'Could not connect. Check that Ollama is running and the address is right.',
    };
  }
}
