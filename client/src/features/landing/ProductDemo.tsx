import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineStep } from '@/features/chat/StepsTimeline';
import { StepsTimeline } from '@/features/chat/StepsTimeline';
import { cn } from '@/lib/utils';

interface DemoStep {
  name: string;
  kind?: string;
  input: unknown;
  output: string;
  ms: number;
}

interface DemoScript {
  prompt: string;
  steps: DemoStep[];
  answer: string;
}

const SCRIPTS: DemoScript[] = [
  {
    prompt: 'Why did last night’s deploy fail?',
    steps: [
      {
        name: 'github_list_runs',
        input: { branch: 'main', status: 'failed', limit: 1 },
        output: 'Run 4821 failed at the migrate step, 02:14 UTC',
        ms: 900,
      },
      {
        name: 'web_fetch',
        input: { url: 'https://ci.example.com/runs/4821/log' },
        output: 'migrate: lock timeout after 300s on table orders',
        ms: 800,
      },
    ],
    answer:
      'The migration timed out waiting for a lock on the orders table. A long report query was holding it. Rerunning outside the report window should fix it.',
  },
  {
    prompt: 'File this bug report as a ticket',
    steps: [
      {
        name: 'Page on-call?',
        kind: 'human_approval',
        input: { message: 'Mentions a checkout crash. Page on-call?' },
        output: 'approved',
        ms: 1300,
      },
      {
        name: 'github_create_issue',
        input: { title: 'Checkout crashes on saved cards', labels: ['bug', 'p1'] },
        output: 'Created issue #1182',
        ms: 800,
      },
    ],
    answer: 'You approved paging on-call, and I filed issue #1182 with the p1 label.',
  },
  {
    prompt: 'What is 18% of ₹2,40,000?',
    steps: [
      {
        name: 'calculator',
        input: { expression: '240000 * 0.18' },
        output: '43200',
        ms: 500,
      },
    ],
    answer: '18% of ₹2,40,000 is ₹43,200.',
  },
];

interface DemoState {
  steps: TimelineStep[];
  answer: string;
  running: boolean;
}

const finalState = (script: DemoScript): DemoState => ({
  steps: script.steps.map((step, index) => ({
    id: String(index),
    name: step.name,
    kind: step.kind,
    status: 'done',
    input: step.input,
    output: step.output,
  })),
  answer: script.answer,
  running: false,
});

/** Plays one recorded run through the same timeline component the real chat uses. */
export function ProductDemo() {
  const [active, setActive] = useState(0);
  const [state, setState] = useState<DemoState>({ steps: [], answer: '', running: false });
  const panel = useRef<HTMLDivElement>(null);
  const playId = useRef(0);
  const started = useRef(false);

  const play = useCallback(async (index: number) => {
    const script = SCRIPTS[index];
    if (!script) return;
    const id = ++playId.current;
    // A choice made before the panel scrolls into view must not get replaced by the auto-play.
    started.current = true;
    setActive(index);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setState(finalState(script));
      return;
    }

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const stale = () => id !== playId.current;
    const steps: TimelineStep[] = [];
    setState({ steps: [], answer: '', running: true });
    await wait(350);

    for (const [stepIndex, step] of script.steps.entries()) {
      if (stale()) return;
      const entry: TimelineStep = {
        id: String(stepIndex),
        name: step.name,
        kind: step.kind,
        status: step.kind === 'human_approval' ? 'waiting' : 'running',
        input: step.input,
      };
      steps.push(entry);
      setState({ steps: [...steps], answer: '', running: true });
      await wait(step.ms);
      if (stale()) return;
      steps[stepIndex] = { ...entry, status: 'done', output: step.output };
      setState({ steps: [...steps], answer: '', running: true });
    }

    let text = '';
    for (const word of script.answer.match(/\S+\s*/g) ?? []) {
      if (stale()) return;
      text += word;
      setState({ steps: [...steps], answer: text, running: true });
      await wait(38);
    }
    if (!stale()) setState({ steps: [...steps], answer: text, running: false });
  }, []);

  // Plays once, the first time the panel scrolls into view.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !started.current) void play(0);
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      playId.current += 1;
    };
  }, [play]);

  const script = SCRIPTS[active];

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <div className="space-y-6 lg:sticky lg:top-28">
        <h2 className="font-display text-3xl leading-[1.08] font-semibold text-balance sm:text-[2.6rem]">
          See what your agent did, not just what it said
        </h2>
        <p className="max-w-md text-lg text-muted-foreground">
          Each tool call appears as it happens, with its input and output one click away. Pick a
          question to replay a sample run.
        </p>
        <div role="group" aria-label="Sample questions" className="flex flex-col items-start gap-2">
          {SCRIPTS.map((item, index) => (
            <button
              key={item.prompt}
              type="button"
              aria-pressed={active === index}
              onClick={() => void play(index)}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-lg border px-4 py-2 text-left font-medium transition-colors duration-200',
                active === index
                  ? 'border-signal/70 bg-card text-foreground shadow-edge'
                  : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  active === index ? 'bg-signal' : 'bg-muted-foreground/50',
                )}
              />
              {item.prompt}
            </button>
          ))}
        </div>
      </div>

      <div ref={panel} className="panel min-h-[440px] overflow-hidden">
        <div className="flex items-center gap-2.5 border-b px-5 py-3 text-sm text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              'size-2 rounded-full',
              state.running ? 'animate-led bg-signal' : 'bg-success',
            )}
          />
          {state.running ? 'Running a sample' : 'Sample run'}
        </div>
        <div className="space-y-4 p-5 sm:p-7">
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2 text-secondary-foreground">
            {script?.prompt}
          </p>
          <StepsTimeline steps={state.steps} />
          <p aria-live="polite" className="leading-relaxed">
            {state.answer}
            {state.running && state.steps.length > 0 && state.answer && (
              <span aria-hidden className="ml-0.5 inline-block h-4 w-2 animate-blink bg-signal" />
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
