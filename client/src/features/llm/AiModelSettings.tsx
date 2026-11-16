import { CheckCircle2, ChevronDown, Circle, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModelPicker } from '@/features/agents/ModelPicker';
import { useGetProvidersQuery } from '@/features/agents/api';
import { apiErrorMessage } from '@/lib/api';
import type { LlmProvider, LlmSettings, ModelConfig, ProviderInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  useGetLlmSettingsQuery,
  useGetOllamaStatusQuery,
  useUpdateLlmSettingsMutation,
} from './api';
import { KEY_PROVIDERS, PROVIDER_NAMES } from './providers';

const SECTION = 'panel space-y-4 p-5 sm:p-6';
const HEADING = 'font-display text-xl font-semibold';

function ProviderRow({
  title,
  summary,
  status,
  ready,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  status: string;
  ready: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const StatusIcon = ready ? CheckCircle2 : Circle;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger className="flex min-h-11 w-full cursor-pointer items-center gap-3 p-3 text-left">
        <StatusIcon
          className={cn('size-4 shrink-0', ready ? 'text-success' : 'text-muted-foreground')}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="block text-sm text-muted-foreground">{open ? summary : status}</span>
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t p-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function KeyProviderForm({
  provider,
  keyUrl,
  keyPlaceholder,
  settings,
  info,
}: {
  provider: Exclude<LlmProvider, 'ollama'>;
  keyUrl: string;
  keyPlaceholder: string;
  settings: LlmSettings;
  info: ProviderInfo | undefined;
}) {
  const credential = settings.providers.find((item) => item.provider === provider);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(credential?.model ?? '');
  const [update, { isLoading }] = useUpdateLlmSettingsMutation();

  useEffect(() => setModel(credential?.model ?? ''), [credential?.model]);

  const name = PROVIDER_NAMES[provider];
  const unchanged = !apiKey && model.trim() === (credential?.model ?? '');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await update({
        credentials: {
          [provider]: { ...(apiKey ? { apiKey } : {}), model: model.trim() || null },
        },
      }).unwrap();
      setApiKey('');
      toast.success(`${name} saved`);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const removeKey = async () => {
    try {
      await update({ credentials: { [provider]: { apiKey: null } } }).unwrap();
      toast.success(`${name} key removed`);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${provider}-key`}>API key</Label>
        <Input
          id={`${provider}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            credential?.hasKey
              ? `Saved${credential.keyHint ? `, ending ${credential.keyHint}` : ''}. Type to replace it.`
              : keyPlaceholder
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="font-mono"
        />
        <p className="text-sm text-muted-foreground">
          Stored encrypted and never shown again.{' '}
          <a
            href={keyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium underline"
          >
            Get your {name} key
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${provider}-model`}>Model name</Label>
        <Input
          id={`${provider}-model`}
          list={`${provider}-model-list`}
          placeholder={info?.models[0] ?? 'Optional'}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          maxLength={200}
          className="font-mono"
        />
        <datalist id={`${provider}-model-list`}>
          {info?.models.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <p className="text-sm text-muted-foreground">
          Optional. It goes to the top of this provider&apos;s list in chat and agents.
        </p>
      </div>

      {provider === 'openrouter' && (
        <p className="text-sm text-muted-foreground">
          {info?.modelDetails?.length ?? 0} free models are available right now, and you can switch
          between them from the chat box at no cost. OpenRouter limits how often free models can be
          used, and some of their providers may keep your prompts, so avoid sending anything
          private.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isLoading || unchanged}>
          {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save {name}
        </Button>
        {credential?.hasKey && (
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={() => void removeKey()}
          >
            Remove key
          </Button>
        )}
      </div>
    </form>
  );
}

function OllamaForm({ settings }: { settings: LlmSettings }) {
  const credential = settings.providers.find((item) => item.provider === 'ollama');
  const { data: status, isFetching, refetch } = useGetOllamaStatusQuery();
  const [update, { isLoading }] = useUpdateLlmSettingsMutation();
  const [url, setUrl] = useState(settings.ollamaBaseUrl ?? '');
  const [model, setModel] = useState(credential?.model ?? '');
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => setUrl(settings.ollamaBaseUrl ?? ''), [settings.ollamaBaseUrl]);
  useEffect(() => setModel(credential?.model ?? ''), [credential?.model]);

  const unchanged =
    url.trim() === (settings.ollamaBaseUrl ?? '') && model.trim() === (credential?.model ?? '');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    try {
      await update({
        ollamaBaseUrl: url.trim() || null,
        credentials: { ollama: { model: model.trim() || null } },
      }).unwrap();
      toast.success('Ollama saved');
    } catch (error) {
      setFailure(apiErrorMessage(error));
    }
  };

  return (
    <div className="space-y-4">
      {status?.reachable ? (
        <Alert
          tone={status.models.length > 0 ? 'success' : 'warning'}
          title={
            status.models.length > 0
              ? `Connected, with ${status.models.length} ${status.models.length === 1 ? 'model' : 'models'} installed`
              : 'Connected, but no models are installed'
          }
        >
          {status.models.length > 0 ? (
            <span className="font-mono">{status.models.join(', ')}</span>
          ) : (
            <>
              Download one with <code className="font-mono">ollama pull llama3.2</code>
            </>
          )}
        </Alert>
      ) : (
        status && (
          <Alert tone="warning" title="Not connected">
            {status.error ?? 'Ollama is not set up yet. The guide walks through it.'}
          </Alert>
        )
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to="/app/settings/ollama">Open the Ollama guide</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} aria-hidden />
          Check again
        </Button>
      </div>

      <form onSubmit={(event) => void save(event)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ollama-url">Public Ollama address</Label>
          <Input
            id="ollama-url"
            type="url"
            inputMode="url"
            placeholder="https://your-tunnel.example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="font-mono"
          />
          <p className="text-sm text-muted-foreground">
            {settings.serverOllama
              ? 'Leave empty to use the Ollama this server is set up with.'
              : 'Only for a tunnel or remote machine. For Ollama on the same machine as this app, follow the guide instead.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ollama-model">Model name</Label>
          <Input
            id="ollama-model"
            list="ollama-model-list"
            placeholder={status?.models[0] ?? 'llama3.2'}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            maxLength={200}
            className="font-mono"
          />
          <datalist id="ollama-model-list">
            {status?.models.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
          <p className="text-sm text-muted-foreground">
            Optional. Models you have installed already appear in chat and agents.
          </p>
        </div>

        {failure && <Alert tone="error">{failure}</Alert>}

        <Button type="submit" disabled={isLoading || unchanged}>
          {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save Ollama
        </Button>
      </form>
    </div>
  );
}

function DefaultModelForm({
  settings,
  fallback,
}: {
  settings: LlmSettings;
  fallback: ModelConfig;
}) {
  const [value, setValue] = useState<ModelConfig>(settings.defaultModel ?? fallback);
  const [update, { isLoading }] = useUpdateLlmSettingsMutation();

  const save = async (defaultModel: { provider: LlmProvider; name: string } | null) => {
    try {
      await update({ defaultModel }).unwrap();
      toast.success(defaultModel ? 'Default model saved' : 'Default model cleared');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const unchanged =
    settings.defaultModel?.provider === value.provider &&
    settings.defaultModel.name === value.name.trim();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Default model</h3>
        <p className="text-sm text-muted-foreground">
          New chats and workflow steps start on this model. You can still switch in the chat box.
        </p>
      </div>
      <ModelPicker
        idPrefix="default-model"
        value={value}
        onChange={setValue}
        showTemperature={false}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={isLoading || unchanged || !value.name.trim()}
          onClick={() => void save({ provider: value.provider, name: value.name.trim() })}
        >
          {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save default model
        </Button>
        {settings.defaultModel && (
          <Button variant="outline" disabled={isLoading} onClick={() => void save(null)}>
            Clear default model
          </Button>
        )}
      </div>
    </div>
  );
}

function keyStatus(info: ProviderInfo | undefined, keyHint: string | null | undefined): string {
  if (info?.keySource === 'user') {
    return keyHint ? `Using your key ending ${keyHint}` : 'Using your key';
  }
  if (info?.keySource === 'server') {
    return info.freeOnly ? "Using this server's key, free models only" : "Using this server's key";
  }
  return 'No key yet';
}

/** API keys, model names and the Ollama connection, all saved per person. */
export function AiModelSettings() {
  const { data: settings, error: settingsError } = useGetLlmSettingsQuery();
  const { data: providers } = useGetProvidersQuery();
  const { data: ollama } = useGetOllamaStatusQuery();

  const info = (provider: LlmProvider) => providers?.items.find((p) => p.provider === provider);

  const ollamaReady = Boolean(ollama?.reachable && ollama.models.length > 0);
  const ollamaStatus = ollama?.reachable
    ? `Connected, ${ollama.models.length} installed`
    : 'Not connected';

  return (
    <section className={SECTION} aria-labelledby="ai-models-heading">
      <div className="space-y-1">
        <h2 id="ai-models-heading" className={HEADING}>
          AI models
        </h2>
        <p className="text-muted-foreground">
          Add your own keys, or run models on your own computer. Your keys apply only to your
          account and take priority over the ones on this server.
        </p>
      </div>

      {settingsError && <Alert tone="error">{apiErrorMessage(settingsError)}</Alert>}

      {settings && providers && (
        <>
          <div className="space-y-2">
            {KEY_PROVIDERS.map(({ provider, keyUrl, keyPlaceholder, summary }) => {
              const credential = settings.providers.find((item) => item.provider === provider);
              return (
                <ProviderRow
                  key={provider}
                  title={PROVIDER_NAMES[provider]}
                  summary={summary}
                  status={keyStatus(info(provider), credential?.keyHint)}
                  ready={Boolean(info(provider)?.configured)}
                  defaultOpen={provider === 'openrouter' && !info(provider)?.configured}
                >
                  <KeyProviderForm
                    provider={provider}
                    keyUrl={keyUrl}
                    keyPlaceholder={keyPlaceholder}
                    settings={settings}
                    info={info(provider)}
                  />
                </ProviderRow>
              );
            })}
            <ProviderRow
              title="Ollama"
              summary="Models that run on your own computer, with no API key."
              status={ollamaStatus}
              ready={ollamaReady}
            >
              <OllamaForm settings={settings} />
            </ProviderRow>
          </div>

          <DefaultModelForm settings={settings} fallback={providers.default} />
        </>
      )}
    </section>
  );
}
