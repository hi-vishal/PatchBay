import { ArrowLeft, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert } from '@/components/Alert';
import { PageContainer, PageHeader } from '@/components/PageStates';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGetOllamaStatusQuery } from '@/features/llm/api';
import { cn } from '@/lib/utils';

function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text instead.');
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-1 pl-3">
      <pre className="min-w-0 flex-1 overflow-x-auto py-2 font-mono text-sm">
        <code>{children}</code>
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        aria-label={copied ? 'Copied' : 'Copy command'}
        onClick={() => void copy()}
      >
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3">
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-md border bg-card font-display text-base font-semibold"
      >
        {number}
      </span>
      <div className="space-y-3 pb-8">
        <h2 className="pt-1 font-display text-lg leading-snug font-semibold">{title}</h2>
        <div className="space-y-3 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-foreground underline"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function ConnectionStatus() {
  const { data: status, isFetching, refetch } = useGetOllamaStatusQuery();

  const recheck = (
    <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
      <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} aria-hidden />
      Check again
    </Button>
  );

  if (!status) return null;

  if (status.reachable && status.models.length > 0) {
    return (
      <div className="space-y-3">
        <Alert tone="success" title="Ollama is connected">
          Installed: <span className="font-mono">{status.models.join(', ')}</span>. Pick one from
          the model menu in{' '}
          <Link to="/app/chat" className="font-medium underline">
            chat
          </Link>
          .
        </Alert>
        {recheck}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {status.reachable ? (
        <Alert tone="warning" title="Connected, but no models are installed">
          Follow step 2 to download one.
        </Alert>
      ) : (
        <Alert tone="warning" title="Ollama is not connected yet">
          {status.error ?? 'This app has no Ollama address yet. Steps 1 to 3 set that up.'}
        </Alert>
      )}
      {recheck}
    </div>
  );
}

export default function OllamaGuide() {
  return (
    <PageContainer className="max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/app/settings">
          <ArrowLeft className="size-4" aria-hidden />
          Settings
        </Link>
      </Button>

      <PageHeader
        title="Use local models with Ollama"
        description="Ollama runs AI models on hardware you control. There is no API key and no charge per message. Answers are as fast as your machine."
      />

      <ConnectionStatus />

      <ol>
        <Step number={1} title="Install Ollama">
          <p>
            Download it from <OutLink href="https://ollama.com/download">ollama.com</OutLink> for
            Mac, Windows or Linux. The desktop app starts Ollama for you. On a Mac with Homebrew, or
            on Linux, you can use these instead:
          </p>
          <Command>brew install ollama</Command>
          <Command>curl -fsSL https://ollama.com/install.sh | sh</Command>
        </Step>

        <Step number={2} title="Download a model">
          <p>
            This one is about 2 GB and runs on most laptops. It can also call tools, so it works
            with agents.
          </p>
          <Command>ollama pull llama3.2</Command>
          <p>
            If the next step cannot connect, Ollama may not be running. Start it with{' '}
            <code className="font-mono text-foreground">ollama serve</code>.
          </p>
          <p>
            Bigger models answer better but need more memory. Agents that use tools need a model
            from the <OutLink href="https://ollama.com/search?c=tools">tools list</OutLink>.
          </p>
        </Step>

        <Step number={3} title="Connect it to this app">
          <p>
            The server running this app talks to Ollama, not your browser. So what you do depends on
            where the server runs.
          </p>
          <Tabs defaultValue="dev">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="dev">npm run dev</TabsTrigger>
              <TabsTrigger value="docker">Docker Compose</TabsTrigger>
              <TabsTrigger value="hosted">Hosted site</TabsTrigger>
            </TabsList>
            <TabsContent value="dev" className="space-y-3 pt-2">
              <p>
                Add this line to <code className="font-mono text-foreground">.env</code> in the
                project folder, then restart the app.
              </p>
              <Command>OLLAMA_BASE_URL=http://localhost:11434</Command>
            </TabsContent>
            <TabsContent value="docker" className="space-y-3 pt-2">
              <p>
                Inside a container, <code className="font-mono text-foreground">localhost</code> is
                the container itself. Add this line to{' '}
                <code className="font-mono text-foreground">.env</code>, then restart the API.
              </p>
              <Command>OLLAMA_DOCKER_URL=http://host.docker.internal:11434</Command>
              <Command>docker compose up -d api</Command>
              <p>
                On Linux, Ollama must also listen beyond localhost, so start it with{' '}
                <code className="font-mono text-foreground">OLLAMA_HOST=0.0.0.0 ollama serve</code>.
                Only do this on a network you trust, because Ollama has no password.
              </p>
            </TabsContent>
            <TabsContent value="hosted" className="space-y-3 pt-2">
              <p>
                A hosted server cannot see your computer. <strong>If you run the server,</strong>{' '}
                install Ollama on it and set{' '}
                <code className="font-mono text-foreground">OLLAMA_BASE_URL</code> there. Everyone
                on that site can then use its models.
              </p>
              <p>
                <strong>To use your own computer,</strong> open a tunnel and paste its address under
                Ollama in <Link to="/app/settings">Settings</Link>. Either of these works:
              </p>
              <Command>ngrok http 11434 --host-header=&quot;localhost:11434&quot;</Command>
              <Command>
                cloudflared tunnel --url http://localhost:11434
                --http-host-header=&quot;localhost:11434&quot;
              </Command>
              <Alert tone="warning" title="A tunnel address is public">
                Anyone who has it can use your Ollama and your computer&apos;s time. Keep it private
                and close the tunnel when you finish. Your prompts also pass through this
                site&apos;s server on the way.
              </Alert>
            </TabsContent>
          </Tabs>
        </Step>

        <Step number={4} title="Pick your model">
          <p>
            Press <strong>Check again</strong> at the top of this page. Once it says connected, your
            models appear under Ollama in the{' '}
            <Link to="/app/chat" className="font-medium text-foreground underline">
              chat
            </Link>{' '}
            model menu and in the agent builder. To start on one every time, make it your default in{' '}
            <Link to="/app/settings" className="font-medium text-foreground underline">
              Settings
            </Link>
            .
          </p>
        </Step>
      </ol>

      <section className="space-y-4" aria-labelledby="ollama-problems">
        <h2 id="ollama-problems" className="font-display text-xl font-semibold">
          If something goes wrong
        </h2>
        <dl className="space-y-4">
          <div className="space-y-2">
            <dt className="font-medium">It says it could not connect</dt>
            <dd className="space-y-2 text-muted-foreground">
              <p>Run this on the machine with Ollama. It should list your models.</p>
              <Command>curl http://localhost:11434/api/tags</Command>
              <p>
                If that works, check the address from step 3 and that you restarted the app after
                changing <code className="font-mono text-foreground">.env</code>.
              </p>
            </dd>
          </div>
          <div className="space-y-2">
            <dt className="font-medium">An agent says the model does not support tools</dt>
            <dd className="text-muted-foreground">
              Choose a model from the{' '}
              <OutLink href="https://ollama.com/search?c=tools">tools list</OutLink>, or remove the
              tools from that agent.
            </dd>
          </div>
          <div className="space-y-2">
            <dt className="font-medium">The first answer takes a long time</dt>
            <dd className="text-muted-foreground">
              Ollama loads a model into memory on first use, and later answers are faster. If it
              stays slow, the model is too big for this machine, so try a smaller one.
            </dd>
          </div>
          <div className="space-y-2">
            <dt className="font-medium">Long chats seem to forget earlier messages</dt>
            <dd className="space-y-2 text-muted-foreground">
              <p>
                Ollama keeps only a limited amount of a chat in memory and drops the rest without
                warning. Start it with a larger limit if your machine has the memory:
              </p>
              <Command>OLLAMA_CONTEXT_LENGTH=8192 ollama serve</Command>
            </dd>
          </div>
        </dl>
      </section>
    </PageContainer>
  );
}
