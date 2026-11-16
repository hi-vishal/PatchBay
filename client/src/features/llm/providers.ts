import type { LlmProvider, ProviderInfo } from '@/lib/types';

export const PROVIDER_NAMES: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

/** The providers that take an API key, and where to get one. */
export const KEY_PROVIDERS: {
  provider: Exclude<LlmProvider, 'ollama'>;
  keyUrl: string;
  keyPlaceholder: string;
  summary: string;
}[] = [
  {
    provider: 'openrouter',
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-...',
    summary: 'One key for many models, including free ones.',
  },
  {
    provider: 'anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    summary: 'Claude models.',
  },
  {
    provider: 'openai',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    summary: 'GPT models.',
  },
  {
    provider: 'google',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza...',
    summary: 'Gemini models.',
  },
];

/** A model's readable name where the provider gives one, else its id. */
export function modelLabel(provider: ProviderInfo | undefined, name: string): string {
  return provider?.modelDetails?.find((model) => model.id === name)?.label ?? name;
}
