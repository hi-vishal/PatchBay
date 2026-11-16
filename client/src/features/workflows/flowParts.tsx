import type { EdgeProps, NodeProps } from '@xyflow/react';
import { BaseEdge, Handle, Position, useStore } from '@xyflow/react';
import { memo } from 'react';
import { NODE_META } from '@/lib/nodeMeta';
import { cn } from '@/lib/utils';
import type { CableEdge, StepNode } from './graph';
import { cablePath } from './graph';

const JACK =
  '!size-3.5 !border-2 !border-card !bg-foreground transition-transform duration-150 hover:scale-125';

function BranchHandle({ id, label, top }: { id: string; label: string; top: string }) {
  return (
    <>
      <Handle
        id={id}
        type="source"
        position={Position.Right}
        style={{ top }}
        className={JACK}
        aria-label={`${label} output`}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 -translate-y-1/2 text-xs font-medium text-muted-foreground"
        style={{ top }}
      >
        {label}
      </span>
    </>
  );
}

/** One step on the board: a colored block with jacks to plug cables into. */
export const StepNodeView = memo(function StepNodeView({ data, selected }: NodeProps<StepNode>) {
  const meta = NODE_META[data.kind];
  const Icon = meta.icon;
  const branches = data.kind === 'condition' || data.kind === 'human_approval';
  const [yes, no] = data.kind === 'condition' ? ['True', 'False'] : ['Approved', 'Rejected'];

  return (
    <div
      className={cn(
        'w-52 overflow-hidden rounded-md border bg-card shadow-md transition-shadow duration-150',
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
    >
      <div className="h-1.5" style={{ backgroundColor: meta.color }} />
      <div className={cn('space-y-0.5 px-3 py-2.5', branches && 'pb-8')}>
        <p className={cn('flex items-center gap-1.5 text-xs font-medium', meta.textClass)}>
          <Icon className="size-3.5" aria-hidden />
          {meta.label}
        </p>
        <p className="truncate font-display text-base leading-tight font-semibold">
          {data.label || `Untitled ${meta.label.toLowerCase()}`}
        </p>
      </div>
      <Handle type="target" position={Position.Left} className={JACK} aria-label="Input" />
      {branches ? (
        <>
          <BranchHandle id="true" label={yes as string} top="58%" />
          <BranchHandle id="false" label={no as string} top="82%" />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className={JACK} aria-label="Output" />
      )}
    </div>
  );
});

/** A patch cable, colored by the kind of step it leaves. */
export const CableEdgeView = memo(function CableEdgeView({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
}: EdgeProps<CableEdge>) {
  const kind = useStore((state) => state.nodeLookup.get(source)?.data.kind) as
    keyof typeof NODE_META | undefined;
  return (
    <BaseEdge
      id={id}
      path={cablePath(sourceX, sourceY, targetX, targetY)}
      style={{
        stroke: kind ? NODE_META[kind].color : 'var(--muted-foreground)',
        strokeWidth: selected ? 5 : 3.5,
        strokeLinecap: 'round',
      }}
    />
  );
});
