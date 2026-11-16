import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { currentUser } from '../middleware/protect.js';
import type { LlmSettingsDoc } from '../models/index.js';
import { LLM_PROVIDERS, LlmSettings } from '../models/index.js';
import { inspectOllama, normalizeOllamaUrl } from '../services/llm/catalog.js';
import { resolveOllamaTarget } from '../services/llm/llm.js';
import { encryptJson } from '../utils/crypto.js';
import { AppError } from '../utils/errors.js';
import { assertPublicUrl } from '../utils/ssrf.js';

const HINT_CHARS = 4;
/** Below this, showing the end of a key would give away too much of it. */
const MIN_CHARS_FOR_HINT = 16;

const credentialPatch = z.object({
  // Write-only. Send null to remove the stored key.
  apiKey: z
    .string()
    .trim()
    .min(8, 'That API key looks too short')
    .max(500)
    .regex(/^\S+$/, 'An API key cannot contain spaces')
    .nullable()
    .optional(),
  model: z.string().trim().min(1).max(200).nullable().optional(),
});

export const updateLlmSettingsSchema = z.object({
  credentials: z
    .partialRecord(z.enum(LLM_PROVIDERS), credentialPatch)
    .refine((credentials) => !credentials.ollama?.apiKey, {
      error: 'Ollama does not use an API key',
    })
    .optional(),
  defaultModel: z
    .object({ provider: z.enum(LLM_PROVIDERS), name: z.string().trim().min(1).max(200) })
    .nullable()
    .optional(),
  ollamaBaseUrl: z
    .url({ protocol: /^https?$/, error: 'Must be an http or https URL' })
    .max(500)
    .nullable()
    .optional(),
});

type UpdateBody = z.infer<typeof updateLlmSettingsSchema>;

/** Built field by field, so that adding a secret to the model cannot expose it here. */
function toResponse(settings: LlmSettingsDoc | null) {
  return {
    providers: LLM_PROVIDERS.map((provider) => {
      const credential = settings?.credentials.find((item) => item.provider === provider);
      return {
        provider,
        hasKey: Boolean(credential?.encryptedKey),
        keyHint: credential?.keyHint ?? null,
        model: credential?.modelName ?? null,
      };
    }),
    defaultModel: settings?.defaultModel
      ? { provider: settings.defaultModel.provider, name: settings.defaultModel.name }
      : null,
    ollamaBaseUrl: settings?.ollamaBaseUrl ?? null,
    // Whether the deployment has its own Ollama. The address itself stays private.
    serverOllama: Boolean(env.OLLAMA_BASE_URL),
  };
}

function hintFor(apiKey: string): string | undefined {
  return apiKey.length >= MIN_CHARS_FOR_HINT ? apiKey.slice(-HINT_CHARS) : undefined;
}

function applyCredentials(settings: LlmSettingsDoc, patch: NonNullable<UpdateBody['credentials']>) {
  for (const provider of LLM_PROVIDERS) {
    const change = patch[provider];
    if (!change) continue;

    let credential = settings.credentials.find((item) => item.provider === provider);
    if (!credential) {
      settings.credentials.push({ provider });
      credential = settings.credentials.at(-1);
    }
    if (!credential) continue;

    if (change.apiKey === null) {
      credential.encryptedKey = undefined;
      credential.keyHint = undefined;
    } else if (change.apiKey) {
      credential.encryptedKey = encryptJson(change.apiKey);
      credential.keyHint = hintFor(change.apiKey);
    }
    if (change.model !== undefined) credential.modelName = change.model ?? undefined;
  }
}

/** Settings holds user input, so it may only name public addresses. See DECISIONS.md. */
async function checkedOllamaUrl(raw: string): Promise<string> {
  const url = normalizeOllamaUrl(raw);
  try {
    await assertPublicUrl(url);
  } catch (error) {
    if (error instanceof AppError && error.code === 'URL_NOT_ALLOWED') {
      throw new AppError(
        400,
        'OLLAMA_URL_NOT_ALLOWED',
        'Settings only accepts public addresses. For Ollama on the same machine as the API, set OLLAMA_BASE_URL in .env instead. The Ollama guide has the steps.',
      );
    }
    throw error;
  }
  return url;
}

export async function getLlmSettings(req: Request, res: Response): Promise<void> {
  res.json(toResponse(await LlmSettings.findOne({ ownerId: currentUser(req)._id })));
}

export async function updateLlmSettings(req: Request, res: Response): Promise<void> {
  const ownerId = currentUser(req)._id;
  const body = req.body as UpdateBody;
  // Checked first, so a rejected address leaves everything else unsaved too.
  const ollamaBaseUrl = body.ollamaBaseUrl ? await checkedOllamaUrl(body.ollamaBaseUrl) : undefined;

  const settings = await LlmSettings.findOneAndUpdate(
    { ownerId },
    { $setOnInsert: { ownerId } },
    { upsert: true, returnDocument: 'after' },
  );

  if (body.credentials) applyCredentials(settings, body.credentials);
  if (body.defaultModel !== undefined) settings.set('defaultModel', body.defaultModel ?? undefined);
  if (body.ollamaBaseUrl === null) settings.set('ollamaBaseUrl', undefined);
  else if (ollamaBaseUrl) settings.set('ollamaBaseUrl', ollamaBaseUrl);

  await settings.save();
  res.json(toResponse(settings));
}

export async function getOllamaStatus(req: Request, res: Response): Promise<void> {
  const settings = await LlmSettings.findOne({ ownerId: currentUser(req)._id });
  const target = resolveOllamaTarget(settings);
  if (!target) {
    res.json({ configured: false, source: null, reachable: false, models: [] });
    return;
  }
  res.json({
    configured: true,
    source: target.trusted ? 'server' : 'user',
    ...(await inspectOllama(target)),
  });
}
