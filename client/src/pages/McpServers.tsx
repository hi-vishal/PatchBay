import { CheckCircle2, KeyRound, Loader2, Pencil, Plug, Plus, Trash2, XCircle } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/Alert';
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageContainer,
  PageHeader,
  PlanLimitNotice,
} from '@/components/PageStates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  useCreateMcpServerMutation,
  useDeleteMcpServerMutation,
  useListMcpServersQuery,
  useTestMcpServerMutation,
  useUpdateMcpServerMutation,
} from '@/features/mcp/api';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import type { McpServer, McpServerInput, McpTestResult, McpTransport } from '@/lib/types';

const TRANSPORTS: { value: McpTransport; label: string }[] = [
  { value: 'streamable_http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE' },
  { value: 'stdio', label: 'Local command (stdio)' },
];

function ServerDialog({
  server,
  open,
  onClose,
}: {
  server: McpServer | null;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'streamable_http');
  const [url, setUrl] = useState(server?.url ?? '');
  const [command, setCommand] = useState(server?.command ?? '');
  const [args, setArgs] = useState(server?.args.join(' ') ?? '');
  const [token, setToken] = useState('');
  const [clearAuth, setClearAuth] = useState(false);

  const [create, createState] = useCreateMcpServerMutation();
  const [update, updateState] = useUpdateMcpServerMutation();
  const saving = createState.isLoading || updateState.isLoading;
  const failure = createState.error ?? updateState.error;
  const stdio = transport === 'stdio';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body: McpServerInput = {
      name,
      transport,
      ...(stdio ? { command, args: args.split(/\s+/).filter(Boolean) } : { url }),
    };
    if (clearAuth) body.auth = null;
    else if (token) body.auth = { bearerToken: token };

    try {
      if (server) await update({ id: server.id, changes: body }).unwrap();
      else await create(body).unwrap();
      toast.success(server ? 'Server saved' : 'Server added');
      onClose();
    } catch {
      // The error appears in the dialog.
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{server ? `Edit ${server.name}` : 'Add an MCP server'}</DialogTitle>
            <DialogDescription>Agents you attach it to can use all of its tools.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-transport">Connection</Label>
            <Select
              value={transport}
              onValueChange={(value) => setTransport(value as McpTransport)}
            >
              <SelectTrigger id="mcp-transport" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORTS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {stdio ? (
            <>
              <Alert tone="warning">
                Local commands run on the API server, so they are off unless an administrator sets
                MCP_ALLOW_STDIO.
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  required
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-args">Arguments</Label>
                <Input
                  id="mcp-args"
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  className="font-mono"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-url">Server URL</Label>
                <Input
                  id="mcp-url"
                  type="url"
                  required
                  placeholder="https://mcp.example.com/mcp"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-token">Bearer token</Label>
                <Input
                  id="mcp-token"
                  type="password"
                  autoComplete="off"
                  disabled={clearAuth}
                  placeholder={server?.hasAuth ? 'Saved. Leave blank to keep it.' : 'Optional'}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Encrypted before it is stored, and never shown again.
                </p>
              </div>
              {server?.hasAuth && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="mcp-clear-auth"
                    checked={clearAuth}
                    onCheckedChange={(value) => setClearAuth(value === true)}
                  />
                  <Label htmlFor="mcp-clear-auth" className="font-normal">
                    Remove the saved token
                  </Label>
                </div>
              )}
            </>
          )}

          <PlanLimitNotice error={failure} />
          {failure && apiErrorCode(failure) !== 'PLAN_LIMIT_REACHED' && (
            <Alert tone="error">{apiErrorMessage(failure)}</Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {server ? 'Save server' : 'Add server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TestResult({ result }: { result: McpTestResult }) {
  if (!result.ok) {
    return (
      <div className="flex gap-2 rounded-md bg-danger/10 p-3 text-sm">
        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">Could not connect</p>
          <p className="break-words text-muted-foreground">{result.error}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        Connected. {result.tools.length} {result.tools.length === 1 ? 'tool' : 'tools'} available.
      </p>
      <ul className="space-y-1.5">
        {result.tools.map((tool) => (
          <li key={tool.name}>
            <span className="font-mono text-xs">{tool.name}</span>
            {tool.description && (
              <span className="block text-muted-foreground">{tool.description}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ServerRow({
  server,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [test, testState] = useTestMcpServerMutation();
  const [update] = useUpdateMcpServerMutation();
  const [result, setResult] = useState<McpTestResult | null>(null);

  const runTest = async () => {
    setResult(null);
    try {
      setResult(await test(server.id).unwrap());
    } catch (failure) {
      setResult({ ok: false, tools: [], error: apiErrorMessage(failure) });
    }
  };

  return (
    <li className="panel space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            {server.name}
            {server.hasAuth && (
              <KeyRound
                className="size-4 text-muted-foreground"
                aria-label="Has saved credentials"
              />
            )}
          </h2>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {server.url ?? [server.command, ...server.args].join(' ')}
          </p>
          <p className="text-sm text-muted-foreground">
            {TRANSPORTS.find((item) => item.value === server.transport)?.label}
            {server.lastToolSync && `, last connected ${formatRelative(server.lastToolSync)}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor={`enabled-${server.id}`} className="font-normal text-muted-foreground">
            {server.enabled ? 'On' : 'Off'}
          </Label>
          <Switch
            id={`enabled-${server.id}`}
            checked={server.enabled}
            onCheckedChange={(enabled) => void update({ id: server.id, changes: { enabled } })}
          />
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={testState.isLoading}
            onClick={() => void runTest()}
          >
            {testState.isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Test connection
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${server.name}`}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${server.name}`}
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      {result && <TestResult result={result} />}
    </li>
  );
}

export default function McpServers() {
  const { data, isLoading, error, refetch } = useListMcpServersQuery();
  const [remove] = useDeleteMcpServerMutation();
  const [dialog, setDialog] = useState<{ server: McpServer | null } | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id).unwrap();
      toast.success(`${deleting.name} removed`);
    } catch (failure) {
      toast.error(apiErrorMessage(failure));
    }
    setDeleting(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title="MCP servers"
        description="Connect external tools. Attach a server to an agent to let it use them."
        actions={
          <Button onClick={() => setDialog({ server: null })}>
            <Plus className="size-4" aria-hidden />
            Add server
          </Button>
        }
      />

      {isLoading && <ListSkeleton />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <EmptyState
          icon={Plug}
          title="No servers connected"
          action={<Button onClick={() => setDialog({ server: null })}>Add server</Button>}
        >
          Paste the URL of an MCP server to make its tools available to your agents.
        </EmptyState>
      )}

      <ul className="space-y-3">
        {data?.map((server) => (
          <ServerRow
            key={server.id}
            server={server}
            onEdit={() => setDialog({ server })}
            onDelete={() => setDeleting(server)}
          />
        ))}
      </ul>

      {dialog && (
        <ServerDialog
          key={dialog.server?.id ?? 'new'}
          open
          server={dialog.server}
          onClose={() => setDialog(null)}
        />
      )}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents using it lose its tools, and its saved credentials are deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep server</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Remove server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
