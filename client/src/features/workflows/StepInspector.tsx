import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useGetProvidersQuery, useListAgentsQuery } from '@/features/agents/api';
import { ModelPicker } from '@/features/agents/ModelPicker';
import { BUILTIN_TOOLS, NODE_META } from '@/lib/nodeMeta';
import type { ModelConfig } from '@/lib/types';
import type { StepData, StepNode } from './graph';

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'greater_than', label: 'is greater than' },
  { value: 'less_than', label: 'is less than' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'not_empty', label: 'is not empty' },
];

const TEMPLATE_HELP = (
  <p className="text-sm text-muted-foreground">
    Use <code className="font-mono text-xs">{'{{input}}'}</code> for the run’s input,{' '}
    <code className="font-mono text-xs">{'{{last}}'}</code> for the previous step’s output, or{' '}
    <code className="font-mono text-xs">{'{{nodes.step-id}}'}</code> for a specific step.
  </p>
);

type Config = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Edits tool arguments as JSON. The node only updates when the text parses. */
function ArgsEditor({ value, onChange }: { value: Config; onChange: (args: Config) => void }) {
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor="step-args">Arguments (JSON)</Label>
      <Textarea
        id="step-args"
        rows={5}
        value={draft}
        aria-invalid={invalid}
        className="font-mono text-xs"
        onChange={(event) => {
          setDraft(event.target.value);
          try {
            const parsed: unknown = JSON.parse(event.target.value);
            const isObject =
              typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
            setInvalid(!isObject);
            if (isObject) onChange(parsed as Config);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && <p className="text-sm text-danger">This is not a valid JSON object.</p>}
    </div>
  );
}

function ConfigFields({
  kind,
  config,
  onChange,
}: {
  kind: StepData['kind'];
  config: Config;
  onChange: (config: Config) => void;
}) {
  const { data: agents } = useListAgentsQuery(undefined, { skip: kind !== 'agent' });
  const { data: providers } = useGetProvidersQuery(undefined, { skip: kind !== 'llm' });
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  switch (kind) {
    case 'llm': {
      const model = config.model as ModelConfig | undefined;
      return (
        <>
          <div className="space-y-2">
            <Label htmlFor="step-prompt">Prompt</Label>
            <Textarea
              id="step-prompt"
              rows={6}
              value={text(config.prompt)}
              onChange={(event) => set('prompt', event.target.value)}
            />
            {TEMPLATE_HELP}
          </div>
          <div className="space-y-2">
            <Label htmlFor="step-system">Instructions</Label>
            <Textarea
              id="step-system"
              rows={3}
              placeholder="Optional"
              value={text(config.systemPrompt)}
              onChange={(event) => set('systemPrompt', event.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="step-own-model" className="font-normal">
              Use a specific model
            </Label>
            <Switch
              id="step-own-model"
              checked={Boolean(model)}
              onCheckedChange={(on) => {
                const { model: _removed, ...rest } = config;
                onChange(
                  on
                    ? {
                        ...rest,
                        model: {
                          ...(providers?.default ?? {
                            provider: 'anthropic',
                            name: 'claude-opus-5-5',
                          }),
                          temperature: 0.7,
                        },
                      }
                    : rest,
                );
              }}
            />
          </div>
          {model && (
            <ModelPicker
              idPrefix="step-model"
              value={model}
              onChange={(next) => set('model', next)}
            />
          )}
        </>
      );
    }
    case 'agent':
      return (
        <>
          <div className="space-y-2">
            <Label htmlFor="step-agent">Agent</Label>
            <Select value={text(config.agentId)} onValueChange={(value) => set('agentId', value)}>
              <SelectTrigger id="step-agent" className="w-full">
                <SelectValue placeholder="Choose an agent" />
              </SelectTrigger>
              <SelectContent>
                {agents?.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agents?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                You have no agents yet.{' '}
                <Link to="/app/agents/new" className="text-link underline-offset-4 hover:underline">
                  Build one
                </Link>
                .
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="step-input">Task for the agent</Label>
            <Textarea
              id="step-input"
              rows={4}
              value={text(config.input)}
              onChange={(event) => set('input', event.target.value)}
            />
            {TEMPLATE_HELP}
          </div>
        </>
      );
    case 'tool':
      return (
        <>
          <div className="space-y-2">
            <Label htmlFor="step-tool">Tool</Label>
            <Select value={text(config.tool)} onValueChange={(value) => set('tool', value)}>
              <SelectTrigger id="step-tool" className="w-full">
                <SelectValue placeholder="Choose a tool" />
              </SelectTrigger>
              <SelectContent>
                {BUILTIN_TOOLS.map((tool) => (
                  <SelectItem key={tool.id} value={tool.id}>
                    {tool.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ArgsEditor
            value={(config.args as Config | undefined) ?? {}}
            onChange={(args) => set('args', args)}
          />
          {TEMPLATE_HELP}
        </>
      );
    case 'condition':
      return (
        <>
          <div className="space-y-2">
            <Label htmlFor="step-source">Check this text</Label>
            <Input
              id="step-source"
              value={text(config.source)}
              onChange={(event) => set('source', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="step-operator">Rule</Label>
            <Select value={text(config.operator)} onValueChange={(value) => set('operator', value)}>
              <SelectTrigger id="step-operator" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((operator) => (
                  <SelectItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!['is_empty', 'not_empty'].includes(text(config.operator)) && (
            <div className="space-y-2">
              <Label htmlFor="step-value">Value</Label>
              <Input
                id="step-value"
                value={text(config.value)}
                onChange={(event) => set('value', event.target.value)}
              />
            </div>
          )}
          {TEMPLATE_HELP}
        </>
      );
    case 'human_approval':
      return (
        <div className="space-y-2">
          <Label htmlFor="step-message">Question for the approver</Label>
          <Textarea
            id="step-message"
            rows={3}
            value={text(config.message)}
            onChange={(event) => set('message', event.target.value)}
          />
        </div>
      );
  }
}

export function StepInspector({
  node,
  onChange,
  onDelete,
}: {
  node: StepNode;
  onChange: (data: StepData) => void;
  onDelete: () => void;
}) {
  const meta = NODE_META[node.data.kind];
  const Icon = meta.icon;

  // The tool args editor keeps local text, so it restarts when another step is selected.
  const [editorKey, setEditorKey] = useState(node.id);
  useEffect(() => setEditorKey(node.id), [node.id]);

  return (
    <div key={editorKey} className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className={`flex items-center gap-1.5 text-sm font-medium ${meta.textClass}`}>
            <Icon className="size-4" aria-hidden />
            {meta.label}
          </p>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Delete this step" onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </header>

      <div className="space-y-2">
        <Label htmlFor="step-label">Name</Label>
        <Input
          id="step-label"
          maxLength={200}
          value={node.data.label}
          onChange={(event) => onChange({ ...node.data, label: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Step id: <code className="font-mono">{node.id}</code>
        </p>
      </div>

      <ConfigFields
        kind={node.data.kind}
        config={node.data.config}
        onChange={(config) => onChange({ ...node.data, config })}
      />
    </div>
  );
}
