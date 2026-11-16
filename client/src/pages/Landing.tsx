import type { LucideIcon } from 'lucide-react';
import {
  Check,
  ChevronDown,
  CircleCheck,
  Eye,
  FileCheck2,
  Hand,
  KeyRound,
  Loader2,
  Plug,
  ShieldCheck,
  UserCheck,
  Waypoints,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { FALLBACK_PLANS, planFeatures, useGetPlansQuery } from '@/features/billing/api';
import { Offer } from '@/features/landing/Offer';
import { PatchBoard } from '@/features/landing/PatchBoard';
import { ProductDemo } from '@/features/landing/ProductDemo';
import { useReveal } from '@/hooks/useReveal';
import { BUILTIN_TOOLS } from '@/lib/nodeMeta';
import type { PlanInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

const SECTION = 'mx-auto w-full max-w-7xl px-5 sm:px-8';
const H2 = 'font-display text-3xl leading-[1.08] font-semibold text-balance sm:text-[2.6rem]';
const LEAD = 'max-w-[58ch] text-lg text-muted-foreground';

const LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#how', label: 'How it works' },
  { href: '#security', label: 'Security' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'Questions' },
];

function Header({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="fixed inset-x-3 top-3 z-40 sm:inset-x-5">
      <div className="rack mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 rounded-2xl border bg-card/80 pr-2 pl-5 shadow-lift backdrop-blur-xl">
        <Link to="/" aria-label="Patchbay home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {!signedIn && (
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link to="/login">Sign in</Link>
            </Button>
          )}
          <Button asChild variant="signal">
            <Link to={signedIn ? '/app' : '/login'}>{signedIn ? 'Open app' : 'Start free'}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="rack perf relative overflow-hidden">
      <div
        className={cn(
          SECTION,
          'relative z-10 flex items-center pt-32 pb-6 lg:min-h-[100dvh] lg:py-28',
        )}
      >
        <div className="max-w-xl space-y-7 lg:max-w-[35rem]">
          <p
            className="flex w-fit animate-rise items-center gap-2.5 rounded-full border bg-card/70 py-1.5 pr-4 pl-3 text-sm text-muted-foreground shadow-edge"
            style={{ animationDelay: '60ms' }}
          >
            <span aria-hidden className="size-2 animate-led rounded-full bg-signal" />
            Free to start. No card needed.
          </p>
          <h1
            className="animate-rise font-display text-[2.6rem] leading-[1.03] font-semibold text-balance sm:text-6xl xl:text-[4.25rem]"
            style={{ animationDelay: '140ms' }}
          >
            Wire your tools into an AI agent
          </h1>
          <p
            className="max-w-[46ch] animate-rise text-lg text-muted-foreground sm:text-xl"
            style={{ animationDelay: '220ms' }}
          >
            Give an agent a job and the tools to do it, then watch every step it takes. You see the
            work, not only the answer, and nothing important happens without your say.
          </p>
          <div
            className="flex animate-rise flex-wrap items-center gap-3"
            style={{ animationDelay: '300ms' }}
          >
            <Button asChild size="lg" variant="signal" className="h-12 px-7 text-base">
              <Link to={signedIn ? '/app' : '/login'}>
                {signedIn ? 'Open your dashboard' : 'Start free'}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
              <a href="#demo">Watch a sample run</a>
            </Button>
          </div>
          <p
            className="animate-rise text-sm text-muted-foreground"
            style={{ animationDelay: '380ms' }}
          >
            Works with OpenAI, Anthropic, Google, OpenRouter and Ollama.
          </p>
        </div>
      </div>

      <PatchBoard className="h-[340px] w-full sm:h-[460px] lg:absolute lg:inset-y-0 lg:right-[-9%] lg:h-full lg:w-[68%] lg:[mask-image:linear-gradient(to_right,transparent,black_9%)]" />
    </section>
  );
}

/** Small pictures for the three reasons. Each mirrors a real screen, with sample content. */
function StepsPicture() {
  const rows = [
    { name: 'github_list_runs', done: true },
    { name: 'web_fetch', done: true },
    { name: 'calculator', done: false },
  ];
  return (
    <div aria-hidden className="panel divide-y overflow-hidden">
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-3 px-4 py-3">
          <span className="h-5 w-[3px] rounded-full bg-node-tool" />
          <span className="flex-1 truncate font-mono text-sm">{row.name}</span>
          {row.done ? (
            <CircleCheck className="size-4 text-success" />
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      ))}
      <div className="space-y-1.5 bg-muted/60 px-4 py-3 font-mono text-xs text-muted-foreground">
        <p>input &nbsp;{'{ "expression": "240000 * 0.18" }'}</p>
        <p>output 43200</p>
      </div>
    </div>
  );
}

function ToolsPicture() {
  return (
    <div aria-hidden className="panel space-y-4 p-5">
      <div className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 font-mono text-sm shadow-edge">
        <Plug className="size-4 shrink-0 text-node-agent" />
        <span className="min-w-0 truncate text-muted-foreground">
          https://mcp.example.com/github
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-sans text-xs text-success">
          <span className="size-1.5 rounded-full bg-success" />
          Connected
        </span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {BUILTIN_TOOLS.map((tool) => (
          <li key={tool.id} className="flex items-center gap-2 text-sm">
            <Check className="size-4 shrink-0 text-node-tool" />
            {tool.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalPicture() {
  return (
    <div aria-hidden className="panel space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-node-approval/15">
          <Hand className="size-4 text-node-approval" />
        </span>
        <div className="space-y-1">
          <p className="font-medium">Send this email to 2,400 customers?</p>
          <p className="text-sm text-muted-foreground">The run is paused until someone decides.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <span className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Approve
        </span>
        <span className="rounded-md border px-4 py-2 text-sm font-medium">Reject</span>
      </div>
    </div>
  );
}

const REASONS = [
  {
    problem: 'An answer with no trail is hard to trust.',
    title: 'Every step is on the record',
    body: 'Each tool call shows up as it happens, with what went in and what came back. When an answer looks off, you open the step and read it yourself. No guessing, and no digging through logs.',
    picture: <StepsPicture />,
  },
  {
    problem: 'Your tools live in a dozen different places.',
    title: 'One socket for every tool',
    body: 'Connect any MCP server by URL or by local command and its tools appear for your agents. Four built-in tools cover web pages, web APIs, arithmetic and the clock from the first minute.',
    picture: <ToolsPicture />,
  },
  {
    problem: 'Automation you cannot stop is a liability.',
    title: 'Nothing important ships without you',
    body: 'Drop an approval step anywhere in a workflow. The run waits there, for minutes or for days, until a person says yes or no. You can also stop a reply mid-sentence and retry it.',
    picture: <ApprovalPicture />,
  },
];

function Why() {
  return (
    <section id="product" className="scroll-mt-24 py-20 lg:py-28">
      <div className={cn(SECTION, 'space-y-16 lg:space-y-24')}>
        <div data-reveal className="max-w-3xl space-y-5">
          <h2 className={H2}>Most agents ask for your trust. This one shows its work.</h2>
          <p className={LEAD}>
            Handing real work to a model tends to go wrong in three ways. Patchbay is built around
            putting each of them right.
          </p>
        </div>
        {REASONS.map((reason, index) => (
          <div
            key={reason.title}
            data-reveal
            className="grid items-center gap-8 lg:grid-cols-2 lg:gap-20"
          >
            <div className={cn('min-w-0 space-y-4', index % 2 === 1 && 'lg:order-2')}>
              <p className="text-muted-foreground">{reason.problem}</p>
              <h3 className="font-display text-2xl leading-tight font-semibold sm:text-[2rem]">
                {reason.title}
              </h3>
              <p className="max-w-[52ch] text-lg text-muted-foreground">{reason.body}</p>
            </div>
            <div
              className={cn(
                'perf min-w-0 rounded-3xl border p-5 sm:p-10',
                index % 2 === 1 && 'lg:order-1',
              )}
            >
              {reason.picture}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'Connect a model',
    body: 'Add a key in Settings, choose a free model on OpenRouter, or point Patchbay at Ollama running on your own machine.',
  },
  {
    title: 'Give an agent a job',
    body: 'Describe what it should do in plain words, choose its model and switch on the tools it may use. Try it in the built-in test chat.',
  },
  {
    title: 'Wire it into a workflow',
    body: 'Chain prompts, agents, tools and conditions on a board. Add an approval wherever a person should decide, then run it and watch each step.',
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 border-y py-20 lg:py-28">
      <div className={cn(SECTION, 'space-y-14')} data-reveal>
        <div className="max-w-3xl space-y-5">
          <h2 className={H2}>From sign-in to a running agent in three steps</h2>
          <p className={LEAD}>There is nothing to install and no code to write.</p>
        </div>
        <div className="relative">
          <svg
            viewBox="0 0 1000 60"
            preserveAspectRatio="none"
            aria-hidden
            className="absolute inset-x-0 top-0 hidden h-14 w-full lg:block"
          >
            <path
              className="cable-draw"
              pathLength="1"
              d="M11.5 15 C100 64 265 64 354 15 C443 64 607 64 696 15"
              fill="none"
              stroke="var(--signal)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <ol className="grid gap-10 lg:grid-cols-3 lg:gap-8">
            {STEPS.map((step, index) => (
              <li key={step.title} className="space-y-4">
                <span className="relative grid size-7 place-items-center rounded-full border-2 border-foreground bg-background text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <h3 className="pt-6 font-display text-xl font-semibold lg:pt-10">{step.title}</h3>
                <p className="max-w-[40ch] text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const SAFEGUARDS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: KeyRound,
    title: 'Keys are encrypted',
    body: 'Model keys and MCP credentials are encrypted with AES-256-GCM before they are stored. They are decrypted only at the moment of a call, and never written to a log.',
  },
  {
    icon: UserCheck,
    title: 'Your work stays yours',
    body: 'Every chat, agent, workflow and server is checked against its owner on every single request.',
  },
  {
    icon: Waypoints,
    title: 'Web tools stay outside',
    body: 'The built-in web tools refuse private and internal addresses, so an agent cannot be talked into reaching inside a network.',
  },
  {
    icon: FileCheck2,
    title: 'Input is checked first',
    body: 'Each request is validated before anything uses it, and rate limits slow down anyone who hammers the service.',
  },
  {
    icon: ShieldCheck,
    title: 'Payments are verified',
    body: 'Payment notices are checked against their signature and handled once, even when one arrives twice.',
  },
  {
    icon: Eye,
    title: 'A person can always step in',
    body: 'Approval steps hold a run until someone decides, and every step a run took stays on the record.',
  },
];

function Security() {
  return (
    <section id="security" className="scroll-mt-24 py-20 lg:py-28">
      <div
        className={cn(SECTION, 'grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20')}
      >
        <div data-reveal className="space-y-5 lg:sticky lg:top-28 lg:self-start">
          <h2 className={H2}>Built to be trusted with real credentials</h2>
          <p className={LEAD}>
            This is not a page of promises. Each line here describes what the product does today.
          </p>
        </div>
        <dl data-reveal className="divide-y border-y">
          {SAFEGUARDS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="grid gap-2 py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
              <dt className="flex items-center gap-3 font-medium">
                <Icon className="size-4 shrink-0 text-signal" aria-hidden />
                {title}
              </dt>
              <dd className="text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const LIMIT_ROWS: { key: keyof PlanInfo['limits']; label: string }[] = [
  { key: 'messagesPerMonth', label: 'Chat messages each month' },
  { key: 'runsPerMonth', label: 'Workflow runs each month' },
  { key: 'agents', label: 'Agents' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'mcpServers', label: 'MCP servers' },
];

function Pricing({ signedIn }: { signedIn: boolean }) {
  const { data } = useGetPlansQuery();
  const plans = data ?? FALLBACK_PLANS;
  const free = plans.find((plan) => plan.id === 'free');
  const pro = plans.find((plan) => plan.id === 'pro');
  const times = (key: keyof PlanInfo['limits']) =>
    free && pro && free.limits[key] > 0 ? Math.round(pro.limits[key] / free.limits[key]) : null;

  const reasons = [
    {
      title: 'Room to run every day',
      body:
        times('messagesPerMonth') && times('runsPerMonth')
          ? `Pro gives you ${times('messagesPerMonth')} times the chat messages and ${times('runsPerMonth')} times the workflow runs of the free plan.`
          : 'Pro raises every limit on the free plan.',
    },
    {
      title: 'No markup on models',
      body: 'You pay your model provider directly, or nothing at all with a free or local model. Patchbay never adds a margin to tokens.',
    },
    {
      title: 'Leave whenever you like',
      body: 'Cancel from the Billing page. You keep Pro until the period ends, and your agents and workflows stay where they are.',
    },
  ];

  return (
    <section id="pricing" className="scroll-mt-24 border-t py-20 lg:py-28">
      <div className={cn(SECTION, 'space-y-14')}>
        <div data-reveal className="max-w-3xl space-y-5">
          <h2 className={H2}>Start free. Pay when it earns its keep.</h2>
          <p className={LEAD}>
            The free plan includes every feature, so you can judge the product on real work. Pro is
            for the day your agents have more to do than the free plan allows.
          </p>
        </div>

        <div data-reveal className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {plans.map((plan) => {
            const featured = plan.id === 'pro';
            return (
              <article
                key={plan.id}
                className={cn(
                  'flex flex-col gap-7 rounded-2xl border p-7 sm:p-9',
                  featured ? 'rack perf shadow-lift' : 'bg-card shadow-lift',
                )}
              >
                <div className="space-y-1.5">
                  <h3 className="font-display text-2xl font-semibold">{plan.name}</h3>
                  <p className="text-muted-foreground">{plan.description}</p>
                </div>
                <p className="font-display text-4xl font-semibold tabular-nums">{plan.price}</p>
                <ul className="space-y-2.5">
                  {planFeatures(plan).map((feature) => (
                    <li key={feature} className="flex items-center gap-3">
                      <Check
                        className={cn('size-4 shrink-0', featured ? 'text-signal' : 'text-success')}
                        aria-hidden
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  size="lg"
                  variant={featured ? 'signal' : 'default'}
                  className="mt-auto h-12 text-base"
                >
                  <Link to={signedIn ? '/app/billing' : '/login'}>
                    {featured ? 'Get Pro' : 'Start free'}
                  </Link>
                </Button>
              </article>
            );
          })}
        </div>

        <div
          data-reveal
          className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20"
        >
          <div className="space-y-8">
            <h3 className="font-display text-2xl leading-tight font-semibold">
              What you are paying for
            </h3>
            <dl className="space-y-6">
              {reasons.map((reason) => (
                <div key={reason.title} className="space-y-1.5 border-l-2 border-signal pl-5">
                  <dt className="font-medium">{reason.title}</dt>
                  <dd className="text-muted-foreground">{reason.body}</dd>
                </div>
              ))}
            </dl>
          </div>

          {free && pro && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left">
                <caption className="sr-only">What each plan includes</caption>
                <thead>
                  <tr className="border-b text-sm text-muted-foreground">
                    <th scope="col" className="py-3 pr-4 font-medium">
                      Included
                    </th>
                    <th scope="col" className="w-24 py-3 pr-4 font-medium">
                      {free.name}
                    </th>
                    <th scope="col" className="w-24 py-3 font-medium text-foreground">
                      {pro.name}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {LIMIT_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="py-3.5 pr-4 font-normal">
                        {row.label}
                      </th>
                      <td className="py-3.5 pr-4 text-muted-foreground tabular-nums">
                        {free.limits[row.key].toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 font-medium tabular-nums">
                        {pro.limits[row.key].toLocaleString('en-IN')}
                      </td>
                    </tr>
                  ))}
                  {['Streaming chat with tool steps', 'Approval steps', 'Your own model keys'].map(
                    (feature) => (
                      <tr key={feature}>
                        <th scope="row" className="py-3.5 pr-4 font-normal">
                          {feature}
                        </th>
                        {[free.name, pro.name].map((name) => (
                          <td key={name} className="py-3.5 pr-4">
                            <Check className="size-4 text-success" aria-label="Included" />
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p className="mt-5 text-sm text-muted-foreground">
                Payments on this site run in test mode, so upgrading here never charges a real card.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const QUESTIONS = [
  {
    q: 'Do I need a card to start?',
    a: 'No. The free plan asks for a sign-in and nothing else, and it includes every feature.',
  },
  {
    q: 'Which models can I use?',
    a: 'OpenAI, Anthropic and Google models with your own key, any model on OpenRouter including its free ones, and local models through Ollama. You can change model per chat and per agent.',
  },
  {
    q: 'Can I use Patchbay without paying anyone?',
    a: 'Yes. Pair the free plan with a free OpenRouter model, or a model running on your own machine through Ollama, and nothing is charged anywhere.',
  },
  {
    q: 'What is an MCP server?',
    a: 'MCP, the Model Context Protocol, is an open standard for giving models tools. An MCP server offers a set of tools, such as reading a repository or creating an issue, and Patchbay lets your agents use them.',
  },
  {
    q: 'Where do my API keys go?',
    a: 'They are encrypted before they are saved, decrypted only on the server at the moment a model or tool is called, and never written to a log.',
  },
  {
    q: 'What happens when I reach a limit?',
    a: 'Patchbay tells you which limit you reached and what Pro raises it to. Nothing is deleted, and the monthly allowances for messages and runs start again each calendar month.',
  },
  {
    q: 'Can I cancel Pro?',
    a: 'Any time, from the Billing page. You keep Pro until the end of the period you paid for, then move back to the free plan with your work intact.',
  },
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t py-20 lg:py-28">
      <div
        className={cn(SECTION, 'grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20')}
      >
        <div data-reveal className="space-y-5 lg:sticky lg:top-28 lg:self-start">
          <h2 className={H2}>Questions people ask first</h2>
          <p className={LEAD}>
            Plain answers. If yours is missing, the free plan is the fastest way to find out.
          </p>
        </div>
        <div data-reveal className="divide-y border-y">
          {QUESTIONS.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex min-h-16 cursor-pointer items-center justify-between gap-6 py-4 text-lg font-medium transition-colors duration-200 hover:text-link">
                {item.q}
                <ChevronDown
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="max-w-[62ch] pb-6 text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCall({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="rack perf mx-auto max-w-7xl overflow-hidden rounded-3xl border px-6 py-16 sm:px-14 lg:py-24">
        <div className="max-w-2xl space-y-7">
          <h2 className="font-display text-4xl leading-[1.05] font-semibold text-balance sm:text-5xl">
            Give your first agent a job today
          </h2>
          <p className="max-w-[48ch] text-lg text-muted-foreground">
            Sign in, connect a model, and watch it work. It costs nothing to find out whether it
            fits.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" variant="signal" className="h-12 px-7 text-base">
              <Link to={signedIn ? '/app' : '/login'}>
                {signedIn ? 'Open your dashboard' : 'Start free'}
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-12 px-5 text-base">
              <a href="#pricing">Compare plans</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="py-12">
      <div className={cn(SECTION, 'grid gap-10 sm:grid-cols-[1fr_auto_auto] sm:gap-20')}>
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            AI agents that show their work, wired to the tools you already use.
          </p>
        </div>
        <nav aria-label="Product" className="space-y-3 text-sm">
          <p className="font-medium">Product</p>
          <ul className="space-y-2 text-muted-foreground">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="transition-colors duration-200 hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Account" className="space-y-3 text-sm">
          <p className="font-medium">Account</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link
                to={signedIn ? '/app' : '/login'}
                className="transition-colors duration-200 hover:text-foreground"
              >
                {signedIn ? 'Open app' : 'Sign in'}
              </Link>
            </li>
            <li>
              <Link
                to={signedIn ? '/app/billing' : '/login'}
                className="transition-colors duration-200 hover:text-foreground"
              >
                Billing
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div
        className={cn(
          SECTION,
          'mt-10 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:justify-between',
        )}
      >
        <p>© {new Date().getFullYear()} Vishal Gupta. All rights reserved.</p>
        <p>Patchbay™ is a trademark of Vishal Gupta. Created by Vishal Gupta.</p>
      </div>
    </footer>
  );
}

export default function Landing() {
  const signedIn = useAppSelector((state) => state.auth.status === 'authenticated');
  const page = useReveal<HTMLDivElement>();

  return (
    <div ref={page} className="overflow-x-clip">
      <Header signedIn={signedIn} />
      <main>
        <Hero signedIn={signedIn} />
        <Why />
        <section id="demo" className="scroll-mt-24 px-3 sm:px-5">
          <div className="rack perf mx-auto max-w-7xl rounded-3xl border px-5 py-16 sm:px-12 lg:py-24">
            <ProductDemo />
          </div>
        </section>
        <section aria-label="What you get" className="py-20 lg:py-28">
          <div className={cn(SECTION, 'space-y-12')}>
            <div data-reveal className="max-w-3xl space-y-5">
              <h2 className={H2}>Everything it takes to put an agent to work</h2>
              <p className={LEAD}>
                Six parts, one product. Each of them is on the free plan from your first sign-in.
              </p>
            </div>
            <Offer />
          </div>
        </section>
        <HowItWorks />
        <Security />
        <Pricing signedIn={signedIn} />
        <Faq />
        <ClosingCall signedIn={signedIn} />
      </main>
      <Footer signedIn={signedIn} />
    </div>
  );
}
