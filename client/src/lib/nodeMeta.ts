import type { LucideIcon } from 'lucide-react';
import { Bot, GitBranch, Hand, Plug, Sparkles, Wrench } from 'lucide-react';
import type { BuiltinTool, WorkflowNodeType } from '@/lib/types';

export interface NodeMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  /** CSS variable, also used directly for cables. */
  color: string;
  /** Tailwind text color for the same hue. */
  textClass: string;
}

export const NODE_META: Record<WorkflowNodeType, NodeMeta> = {
  llm: {
    label: 'Prompt',
    description: 'Ask a model and keep its answer',
    icon: Sparkles,
    color: 'var(--node-llm)',
    textClass: 'text-node-llm',
  },
  agent: {
    label: 'Agent',
    description: 'Hand the task to one of your agents',
    icon: Bot,
    color: 'var(--node-agent)',
    textClass: 'text-node-agent',
  },
  tool: {
    label: 'Tool',
    description: 'Run a built-in tool',
    icon: Wrench,
    color: 'var(--node-tool)',
    textClass: 'text-node-tool',
  },
  condition: {
    label: 'Condition',
    description: 'Choose a path based on the last output',
    icon: GitBranch,
    color: 'var(--node-condition)',
    textClass: 'text-node-condition',
  },
  human_approval: {
    label: 'Approval',
    description: 'Wait for a person to approve or reject',
    icon: Hand,
    color: 'var(--node-approval)',
    textClass: 'text-node-approval',
  },
};

export const MCP_META: Pick<NodeMeta, 'icon' | 'color' | 'textClass'> = {
  icon: Plug,
  color: 'var(--node-agent)',
  textClass: 'text-node-agent',
};

export const BUILTIN_TOOLS: { id: BuiltinTool; name: string; description: string }[] = [
  { id: 'web_fetch', name: 'Read web pages', description: 'Fetch a public page as text' },
  { id: 'http_request', name: 'Call web APIs', description: 'Send requests to public URLs' },
  { id: 'calculator', name: 'Calculator', description: 'Work out arithmetic exactly' },
  { id: 'current_time', name: 'Current time', description: 'Get the date and time in any zone' },
];
