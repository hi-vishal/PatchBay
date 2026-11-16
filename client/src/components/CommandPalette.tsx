import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  CreditCard,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  Moon,
  Plug,
  Plus,
  Search,
  Settings,
  Sun,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/app/hooks';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Theme } from '@/features/ui/uiSlice';
import { themeChanged } from '@/features/ui/uiSlice';
import { cn } from '@/lib/utils';

interface Command {
  id: string;
  group: string;
  label: string;
  /** Extra words the search matches, beyond the label. */
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

/** Jump to any screen or start something new from the keyboard. Opens with Ctrl or Cmd + K. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => void navigate(to);
    const theme = (value: Theme) => () => void dispatch(themeChanged(value));
    return [
      {
        id: 'new-chat',
        group: 'Start',
        label: 'New chat',
        keywords: 'ask message',
        icon: Plus,
        run: go('/app/chat'),
      },
      {
        id: 'new-agent',
        group: 'Start',
        label: 'Build an agent',
        keywords: 'create new',
        icon: Plus,
        run: go('/app/agents/new'),
      },
      {
        id: 'dashboard',
        group: 'Go to',
        label: 'Dashboard',
        keywords: 'home usage',
        icon: LayoutDashboard,
        run: go('/app'),
      },
      {
        id: 'chat',
        group: 'Go to',
        label: 'Chat',
        keywords: 'conversations',
        icon: MessageSquare,
        run: go('/app/chat'),
      },
      { id: 'agents', group: 'Go to', label: 'Agents', icon: Bot, run: go('/app/agents') },
      {
        id: 'workflows',
        group: 'Go to',
        label: 'Workflows',
        keywords: 'runs board steps',
        icon: Workflow,
        run: go('/app/workflows'),
      },
      {
        id: 'mcp',
        group: 'Go to',
        label: 'MCP servers',
        keywords: 'tools connect',
        icon: Plug,
        run: go('/app/mcp'),
      },
      {
        id: 'billing',
        group: 'Go to',
        label: 'Billing',
        keywords: 'plan upgrade pro',
        icon: CreditCard,
        run: go('/app/billing'),
      },
      {
        id: 'settings',
        group: 'Go to',
        label: 'Settings',
        keywords: 'models keys ollama',
        icon: Settings,
        run: go('/app/settings'),
      },
      { id: 'light', group: 'Theme', label: 'Use the light theme', icon: Sun, run: theme('light') },
      { id: 'dark', group: 'Theme', label: 'Use the dark theme', icon: Moon, run: theme('dark') },
      {
        id: 'system',
        group: 'Theme',
        label: 'Match my device theme',
        icon: Monitor,
        run: theme('system'),
      },
    ];
  }, [dispatch, navigate]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.keywords ?? ''}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  // A new search always starts from its first result.
  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const choose = (command: Command | undefined) => {
    if (!command) return;
    onOpenChange(false);
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    }
  };

  let lastGroup = '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-xl bg-popover p-0 shadow-lift sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter, use the arrow keys to move, and press Enter to choose.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
            aria-label="Search screens and actions"
            placeholder="Where to?"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-13 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">
            esc
          </kbd>
        </div>
        <ul
          id="command-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(22rem,50dvh)] overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-sm text-muted-foreground">
              Nothing matches “{query}”. Try a screen name, like agents or billing.
            </li>
          )}
          {results.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            const Icon = command.icon;
            return (
              <li key={command.id} role="presentation">
                {heading && (
                  <p className="px-3 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
                    {heading}
                  </p>
                )}
                <div
                  id={`command-${command.id}`}
                  role="option"
                  aria-selected={index === active}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(command)}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-sm',
                    index === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {command.label}
                </div>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
