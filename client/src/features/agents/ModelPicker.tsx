import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PROVIDER_NAMES, modelLabel } from '@/features/llm/providers';
import type { LlmProvider, ModelConfig, ProviderInfo } from '@/lib/types';
import { useGetProvidersQuery } from './api';

const PROVIDERS: LlmProvider[] = ['openrouter', 'ollama', 'anthropic', 'openai', 'google'];
const TYPE_A_NAME = '__type_a_name__';

/** These lists come live from the provider, so they are worth choosing from directly. */
const hasLiveList = (provider: LlmProvider) => provider === 'openrouter' || provider === 'ollama';

function SetupNotice({ provider }: { provider: LlmProvider }) {
  if (provider === 'ollama') {
    return (
      <p className="text-sm text-warning">
        Ollama is not connected, so this model cannot run yet.{' '}
        <Link to="/app/settings/ollama" className="font-medium underline">
          Open the Ollama guide
        </Link>
      </p>
    );
  }
  return (
    <p className="text-sm text-warning">
      {PROVIDER_NAMES[provider]} has no API key yet, so this model cannot run.{' '}
      <Link to="/app/settings" className="font-medium underline">
        Add one in Settings
      </Link>
    </p>
  );
}

/** Provider, model and temperature. Suggests models, but accepts any id the provider offers. */
export function ModelPicker({
  value,
  onChange,
  idPrefix = 'model',
  showTemperature = true,
}: {
  value: ModelConfig;
  onChange: (model: ModelConfig) => void;
  idPrefix?: string;
  showTemperature?: boolean;
}) {
  const { data, isLoading, isError, refetch } = useGetProvidersQuery();
  const providers: ProviderInfo[] = data?.items ?? [];
  const current = providers.find((item) => item.provider === value.provider);
  const listId = `${idPrefix}-suggestions`;
  const nameId = `${idPrefix}-name`;
  const known = current?.models ?? [];

  const [typing, setTyping] = useState(false);
  const useList =
    hasLiveList(value.provider) && !typing && known.length > 0 && known.includes(value.name);
  const selected = current?.modelDetails?.find((model) => model.id === value.name);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
          <Select
            value={value.provider}
            onValueChange={(provider) => {
              const next = providers.find((item) => item.provider === provider);
              setTyping(false);
              onChange({
                ...value,
                provider: provider as LlmProvider,
                name: next?.models[0] ?? '',
              });
            }}
          >
            <SelectTrigger id={`${idPrefix}-provider`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((provider) => {
                const info = providers.find((item) => item.provider === provider);
                return (
                  <SelectItem key={provider} value={provider}>
                    {PROVIDER_NAMES[provider]}
                    {info && !info.configured
                      ? provider === 'ollama'
                        ? ' (not connected)'
                        : ' (no API key)'
                      : ''}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={nameId}>Model</Label>
          {isLoading ? (
            <Skeleton role="status" aria-label="Loading models" className="h-9 w-full" />
          ) : useList ? (
            <Select
              value={value.name}
              onValueChange={(name) => {
                if (name === TYPE_A_NAME) {
                  setTyping(true);
                  return;
                }
                onChange({ ...value, name });
              }}
            >
              <SelectTrigger id={nameId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {known.map((name) => (
                  <SelectItem key={name} value={name}>
                    {modelLabel(current, name)}
                  </SelectItem>
                ))}
                <SelectItem value={TYPE_A_NAME}>Type a model name</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input
                id={nameId}
                list={listId}
                required
                value={value.name}
                onChange={(event) => onChange({ ...value, name: event.target.value })}
                className="font-mono"
              />
              <datalist id={listId}>
                {known.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {hasLiveList(value.provider) && known.length > 0 && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    setTyping(false);
                    if (!known.includes(value.name)) {
                      onChange({ ...value, name: known[0] ?? '' });
                    }
                  }}
                >
                  Choose from the list
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {isError && (
        <p role="alert" className="text-sm text-warning">
          The model list could not be loaded, but you can still type a model name.{' '}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </p>
      )}

      {current && !current.configured && <SetupNotice provider={value.provider} />}

      {current?.freeOnly && current.configured && (
        <p className="text-sm text-muted-foreground">
          This server&apos;s OpenRouter key runs free models only. To use paid ones,{' '}
          <Link to="/app/settings" className="font-medium underline">
            add your own key
          </Link>
          .
        </p>
      )}

      {selected && !selected.supportsTools && (
        <p className="text-sm text-warning">
          This model cannot call tools, so an agent using it can only reply with text.
        </p>
      )}

      {!showTemperature ? null : current?.supportsTemperature ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={`${idPrefix}-temperature`}>Temperature</Label>
            <span className="text-sm text-muted-foreground">
              {(value.temperature ?? 0.7).toFixed(1)}
            </span>
          </div>
          <input
            id={`${idPrefix}-temperature`}
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={value.temperature ?? 0.7}
            onChange={(event) => onChange({ ...value, temperature: Number(event.target.value) })}
            className="h-6 w-full cursor-pointer accent-primary"
          />
          <p className="text-sm text-muted-foreground">
            Lower keeps answers consistent. Higher makes them more varied. Some reasoning models
            ignore this.
          </p>
        </div>
      ) : (
        current && (
          <p className="text-sm text-muted-foreground">
            Temperature does not apply to current {PROVIDER_NAMES[value.provider]} models.
          </p>
        )
      )}
    </div>
  );
}
