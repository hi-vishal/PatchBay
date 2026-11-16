import { memo, useEffect, useRef, useState } from 'react';
import { Meter } from '@/components/Meter';
import { useInView } from '@/hooks/useInView';
import { useSpotlight } from '@/hooks/useSpotlight';
import { BUILTIN_TOOLS, NODE_META } from '@/lib/nodeMeta';
import { cn } from '@/lib/utils';

const TYPED = [
  'Draft a reply to this customer email',
  'Summarize the page at this link',
  'What changed in the last release?',
];

/** A message box that types sample questions. It stops while it is off screen. */
const TypingPrompt = memo(function TypingPrompt() {
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box);
  const [text, setText] = useState(TYPED[0] ?? '');

  useEffect(() => {
    if (!inView || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let line = 0;
    let length = 0;
    let hold = 0;
    const timer = window.setInterval(() => {
      const full = TYPED[line] ?? '';
      if (length < full.length) {
        length += 1;
        setText(full.slice(0, length));
      } else if (hold < 26) {
        hold += 1;
      } else {
        line = (line + 1) % TYPED.length;
        length = 0;
        hold = 0;
        setText('');
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, [inView]);

  return (
    <div ref={box} aria-hidden className="space-y-3">
      <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-secondary px-4 py-2 text-sm">
        Which invoices are overdue?
      </div>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Three are past their due date. The oldest is 41 days late, so I would start there.</p>
      </div>
      <div className="flex min-h-12 items-center gap-2 rounded-lg border bg-background px-4 text-sm shadow-edge">
        <span className="truncate">{text}</span>
        <span className="h-4 w-[2px] shrink-0 animate-blink bg-signal" />
        <span className="ml-auto rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
          Send
        </span>
      </div>
    </div>
  );
});

/** The same five step kinds, in the same colors, as the real workflow board. */
function BoardSketch() {
  const nodes = [
    { x: 6, y: 66, kind: 'llm', label: 'Summarize' },
    { x: 196, y: 66, kind: 'condition', label: 'Urgent?' },
    { x: 386, y: 10, kind: 'human_approval', label: 'Approve' },
    { x: 386, y: 122, kind: 'tool', label: 'File ticket' },
  ] as const;
  const cables = [
    { d: 'M130 90 C152 116 176 116 196 90', kind: 'llm' },
    { d: 'M320 90 C346 92 364 62 386 34', kind: 'human_approval' },
    { d: 'M320 90 C346 138 364 158 386 146', kind: 'tool' },
  ] as const;
  return (
    <svg viewBox="0 0 520 172" className="w-full" aria-hidden>
      <g fill="none" strokeWidth="2.5" strokeLinecap="round">
        {cables.map((cable) => (
          <path
            key={cable.d}
            d={cable.d}
            stroke={NODE_META[cable.kind].color}
            strokeDasharray="8 6"
            className="animate-dash"
          />
        ))}
      </g>
      {nodes.map((node) => (
        <g key={node.label}>
          <rect
            x={node.x}
            y={node.y}
            width="124"
            height="48"
            rx="10"
            fill="var(--card)"
            stroke="var(--border)"
          />
          <rect
            x={node.x}
            y={node.y + 10}
            width="3"
            height="28"
            rx="1.5"
            fill={NODE_META[node.kind].color}
          />
          <text
            x={node.x + 18}
            y={node.y + 29}
            fontFamily="var(--font-sans)"
            fontWeight="500"
            fontSize="14"
            fill="var(--foreground)"
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function AgentFormSketch() {
  return (
    <div aria-hidden className="space-y-3 text-sm">
      <div className="rounded-lg border bg-background px-3 py-2 shadow-edge">Invoice checker</div>
      <ul className="space-y-2">
        {BUILTIN_TOOLS.slice(0, 3).map((tool, index) => (
          <li key={tool.id} className="flex items-center justify-between gap-3">
            <span className="truncate text-muted-foreground">{tool.name}</span>
            <span
              className={cn(
                'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5',
                index < 2 ? 'justify-end bg-signal' : 'bg-secondary',
              )}
            >
              <span className="size-4 rounded-full bg-white shadow-sm" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MODELS = [
  { name: 'OpenRouter', note: 'Free models included' },
  { name: 'Ollama', note: 'Runs on your machine' },
  { name: 'OpenAI', note: 'Your key' },
  { name: 'Anthropic', note: 'Your key' },
  { name: 'Google', note: 'Your key' },
];

function ModelList() {
  return (
    <ul className="divide-y text-sm">
      {MODELS.map((model) => (
        <li key={model.name} className="flex items-center justify-between gap-3 py-2">
          <span className="font-medium">{model.name}</span>
          <span className="text-muted-foreground">{model.note}</span>
        </li>
      ))}
    </ul>
  );
}

function ServerSketch() {
  return (
    <div aria-hidden className="space-y-2 font-mono text-xs">
      {['github_list_runs', 'github_create_issue', 'github_get_file'].map((tool, index) => (
        <div
          key={tool}
          className="flex items-center gap-2.5 rounded-md border bg-background px-3 py-2 shadow-edge"
        >
          <span
            className="size-1.5 rounded-full bg-success animate-led"
            style={{ animationDelay: `${index * 0.4}s` }}
          />
          <span className="truncate">{tool}</span>
        </div>
      ))}
    </div>
  );
}

const SAMPLE_USAGE = [
  { label: 'Messages', value: 1284, max: 2000 },
  { label: 'Workflow runs', value: 173, max: 500 },
  { label: 'Agents', value: 9, max: 50 },
  { label: 'MCP servers', value: 18, max: 20 },
];

function UsageSketch() {
  return (
    <dl aria-hidden className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {SAMPLE_USAGE.map((row) => (
        <div key={row.label} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">
              {row.value.toLocaleString('en-IN')}
              <span className="text-muted-foreground"> of {row.max.toLocaleString('en-IN')}</span>
            </dd>
          </div>
          <Meter value={row.value} max={row.max} label={row.label} />
        </div>
      ))}
    </dl>
  );
}

function Tile({
  title,
  children,
  visual,
  className,
  index,
}: {
  title: string;
  children: string;
  visual: React.ReactNode;
  className?: string;
  index: number;
}) {
  return (
    <article
      data-reveal
      style={{ '--i': index % 3 } as React.CSSProperties}
      className={cn('panel spotlight flex flex-col gap-8 rounded-2xl p-6 sm:p-8', className)}
    >
      <div className="min-h-0 flex-1">{visual}</div>
      <div className="space-y-2">
        <h3 className="font-display text-xl font-semibold">{title}</h3>
        <p className="max-w-[52ch] text-muted-foreground">{children}</p>
      </div>
    </article>
  );
}

/** What the product includes. Uneven tiles, so the bigger ideas get the bigger space. */
export function Offer() {
  const grid = useSpotlight<HTMLDivElement>();
  return (
    <div ref={grid} className="grid gap-4 lg:grid-cols-6">
      <Tile
        index={0}
        className="lg:col-span-4"
        title="Chat that streams, stops and retries"
        visual={<TypingPrompt />}
      >
        Replies arrive word by word. Stop one mid-sentence, retry it in a click, and switch models
        without leaving the conversation.
      </Tile>
      <Tile
        index={1}
        className="lg:col-span-2"
        title="An agent in one form"
        visual={<AgentFormSketch />}
      >
        Write its instructions, pick a model and switch on its tools. Test it on the same screen.
      </Tile>
      <Tile
        index={2}
        className="lg:col-span-3"
        title="Workflows you can read at a glance"
        visual={<BoardSketch />}
      >
        Drag steps onto a board and wire them together. Prompts, agents, tools, conditions and
        approvals each keep their own color from the board to the run log.
      </Tile>
      <Tile
        index={3}
        className="lg:col-span-3"
        title="Your models, your keys"
        visual={<ModelList />}
      >
        Bring a key from the provider you already use, start on a free model, or keep everything on
        your own machine. Patchbay adds no markup to what a model costs.
      </Tile>
      <Tile
        index={4}
        className="lg:col-span-2"
        title="MCP servers, checked first"
        visual={<ServerSketch />}
      >
        Test a connection, see its tools, and switch it off without deleting it. If a server goes
        down mid-run, the run carries on and tells you.
      </Tile>
      <Tile
        index={5}
        className="lg:col-span-4"
        title="Limits you can see coming"
        visual={<UsageSketch />}
      >
        Meters show messages, runs, agents and servers against your plan, so you know where you
        stand before you reach a limit.
      </Tile>
    </div>
  );
}
