import '@xyflow/react/dist/style.css';

import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import { ArrowLeft, Loader2, Play, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppSelector } from '@/app/hooks';
import { Alert } from '@/components/Alert';
import { ErrorState, ListSkeleton, PlanLimitNotice } from '@/components/PageStates';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useGetWorkflowQuery,
  useRunWorkflowMutation,
  useUpdateWorkflowMutation,
} from '@/features/workflows/api';
import { CableEdgeView, StepNodeView } from '@/features/workflows/flowParts';
import type { CableEdge, StepData, StepNode } from '@/features/workflows/graph';
import {
  DEFAULT_CONFIG,
  newNodeId,
  toFlowEdges,
  toFlowNodes,
  toWorkflowGraph,
} from '@/features/workflows/graph';
import { RunPanel } from '@/features/workflows/RunPanel';
import { StepInspector } from '@/features/workflows/StepInspector';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { NODE_META } from '@/lib/nodeMeta';
import type { Workflow, WorkflowNodeType } from '@/lib/types';

const nodeTypes = { step: StepNodeView };
const edgeTypes = { cable: CableEdgeView };
const KINDS = Object.keys(NODE_META) as WorkflowNodeType[];

function useResolvedTheme(): 'dark' | 'light' {
  const theme = useAppSelector((state) => state.ui.theme);
  return useMemo(() => {
    if (theme !== 'system') return theme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, [theme]);
}

function Palette({ onAdd }: { onAdd: (kind: WorkflowNodeType) => void }) {
  return (
    <div className="space-y-1 p-3" role="group" aria-label="Add a step">
      <p className="px-1 pb-1 font-display text-base font-semibold">Add a step</p>
      {KINDS.map((kind) => {
        const meta = NODE_META[kind];
        const Icon = meta.icon;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onAdd(kind)}
            className="flex min-h-11 w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors duration-150 hover:bg-accent"
          >
            <Icon className={`mt-0.5 size-4 shrink-0 ${meta.textClass}`} aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{meta.label}</span>
              <span className="block text-xs text-muted-foreground">{meta.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Editor({ workflow }: { workflow: Workflow }) {
  const colorMode = useResolvedTheme();
  const { screenToFlowPosition } = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(workflow.name);
  const [nodes, setNodes] = useState<StepNode[]>(() => toFlowNodes(workflow.nodes));
  const [edges, setEdges] = useState<CableEdge[]>(() => toFlowEdges(workflow.edges));
  const [dirty, setDirty] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [input, setInput] = useState('');
  const [runId, setRunId] = useState<string | null>(null);

  const [update, updateState] = useUpdateWorkflowMutation();
  const [runWorkflow, runState] = useRunWorkflowMutation();

  const selected = nodes.find((node) => node.selected);

  // Warns before closing the tab with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onNodesChange = useCallback((changes: NodeChange<StepNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) {
      setDirty(true);
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<CableEdge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type !== 'select')) setDirty(true);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          type: 'cable',
          id: `${connection.source}:${connection.sourceHandle ?? 'out'}-${connection.target}`,
        },
        current,
      ),
    );
    setDirty(true);
  }, []);

  const isValidConnection = useCallback(
    (connection: Connection | CableEdge) => connection.source !== connection.target,
    [],
  );

  const addStep = (kind: WorkflowNodeType) => {
    const bounds = canvas.current?.getBoundingClientRect();
    const center = bounds
      ? screenToFlowPosition({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 3,
        })
      : { x: 0, y: 0 };
    // Offsets each new step, so several added in a row do not stack exactly.
    const offset = (nodes.length % 6) * 28;
    const node: StepNode = {
      id: newNodeId(kind),
      type: 'step',
      position: { x: center.x - 104 + offset, y: center.y + offset },
      selected: true,
      data: {
        kind,
        label: NODE_META[kind].label,
        config: structuredClone(DEFAULT_CONFIG[kind]),
      },
    };
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node]);
    setDirty(true);
  };

  const changeSelected = (data: StepData) => {
    setNodes((current) =>
      current.map((node) => (node.id === selected?.id ? { ...node, data } : node)),
    );
    setDirty(true);
  };

  const deleteSelected = () => {
    if (!selected) return;
    setNodes((current) => current.filter((node) => node.id !== selected.id));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id),
    );
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    try {
      await update({
        id: workflow.id,
        changes: { name, ...toWorkflowGraph(nodes, edges) },
      }).unwrap();
      setDirty(false);
      return true;
    } catch (failure) {
      toast.error(apiErrorMessage(failure, 'Could not save the workflow.'));
      return false;
    }
  };

  const startRun = async () => {
    if (!(await save())) return;
    try {
      const run = await runWorkflow({ id: workflow.id, input }).unwrap();
      setRunId(run.id);
      setRunOpen(false);
    } catch {
      // The error stays in the dialog, where the fix is usually a config change.
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to workflows">
          <Link to="/app/workflows">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <Input
          aria-label="Workflow name"
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            setDirty(true);
          }}
          className="h-9 max-w-xs min-w-40 flex-1 border-transparent bg-transparent font-display text-lg font-semibold shadow-none dark:bg-transparent"
        />
        <span className="text-sm text-muted-foreground">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!dirty || updateState.isLoading}
            onClick={() => {
              void save().then((ok) => {
                if (ok) toast.success('Workflow saved');
              });
            }}
          >
            {updateState.isLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Save
          </Button>
          <Button onClick={() => setRunOpen(true)}>
            <Play className="size-4" aria-hidden />
            Run
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r bg-card lg:block">
          <Palette onAdd={addStep} />
        </aside>

        <div ref={canvas} className="relative min-h-[420px] min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            colorMode={colorMode}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={2} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <p className="max-w-xs text-center text-muted-foreground">
                Add your first step, then drag between the dots on its edges to wire steps together.
              </p>
            </div>
          )}
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-t bg-card lg:w-80 lg:border-t-0 lg:border-l xl:w-96">
          <div className="lg:hidden">
            <Palette onAdd={addStep} />
          </div>
          {selected ? (
            <StepInspector
              key={selected.id}
              node={selected}
              onChange={changeSelected}
              onDelete={deleteSelected}
            />
          ) : (
            !runId && (
              <p className="p-4 text-sm text-muted-foreground">
                Select a step to edit it. Steps with no incoming cable run first.
              </p>
            )
          )}
          {runId && !selected && (
            <div className="p-4">
              <RunPanel key={runId} runId={runId} />
            </div>
          )}
        </aside>
      </div>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run this workflow</DialogTitle>
            <DialogDescription>
              Steps read this text as {'{{input}}'}. Your changes are saved first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="run-input">Input</Label>
            <Textarea
              id="run-input"
              rows={4}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <PlanLimitNotice error={runState.error} />
          {runState.error && apiErrorCode(runState.error) !== 'PLAN_LIMIT_REACHED' && (
            <Alert tone="error">{apiErrorMessage(runState.error)}</Alert>
          )}
          <DialogFooter>
            <Button
              disabled={runState.isLoading || updateState.isLoading}
              onClick={() => void startRun()}
            >
              {runState.isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Start run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WorkflowEditor() {
  const { workflowId = '' } = useParams();
  const { data, isLoading, error, refetch } = useGetWorkflowQuery(workflowId);

  if (isLoading) return <ListSkeleton rows={1} className="p-6 [&>*]:h-96" />;
  if (error || !data) {
    return (
      <div className="p-6">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <Editor key={data.id} workflow={data} />
    </ReactFlowProvider>
  );
}
