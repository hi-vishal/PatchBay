import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plug,
  Search,
  Settings,
  Workflow,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { CommandPalette } from '@/components/CommandPalette';
import { Logo } from '@/components/Logo';
import { Meter } from '@/components/Meter';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { mobileNavToggled } from '@/features/ui/uiSlice';
import { useGetMeQuery } from '@/lib/api';
import { signOutUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

const NAV: {
  label?: string;
  items: { to: string; label: string; icon: LucideIcon; end?: boolean }[];
}[] = [
  { items: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    label: 'Build',
    items: [
      { to: '/app/chat', label: 'Chat', icon: MessageSquare },
      { to: '/app/agents', label: 'Agents', icon: Bot },
      { to: '/app/workflows', label: 'Workflows', icon: Workflow },
    ],
  },
  { label: 'Connect', items: [{ to: '/app/mcp', label: 'MCP servers', icon: Plug }] },
  {
    label: 'Account',
    items: [
      { to: '/app/billing', label: 'Billing', icon: CreditCard },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="App" className="space-y-5">
      {NAV.map((group, index) => (
        <div key={group.label ?? index} className="space-y-1">
          {group.label && (
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
          )}
          {group.items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-card text-foreground shadow-lift before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-signal'
                    : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function UsageMeter() {
  const { data } = useGetMeQuery();
  if (!data) return <div className="h-[4.5rem]" />;
  const { usage, limits, user } = data;

  return (
    <Link
      to="/app/billing"
      className="block space-y-2.5 rounded-lg border bg-card p-3 shadow-edge transition-colors duration-150 hover:border-input"
    >
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium capitalize">{user.plan} plan</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {limits.messagesPerMonth === null
            ? `${usage.messages.toLocaleString('en-IN')} messages`
            : `${usage.messages} of ${limits.messagesPerMonth.toLocaleString('en-IN')} messages`}
        </span>
      </div>
      {limits.messagesPerMonth !== null && (
        <Meter
          value={usage.messages}
          max={limits.messagesPerMonth}
          label="Messages used this month"
          segments={20}
        />
      )}
    </Link>
  );
}

function UserMenu() {
  const user = useAppSelector((state) => state.auth.user);
  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto min-h-11 flex-1 justify-start gap-2 px-2 py-1.5">
          <Avatar className="size-7">
            <AvatarImage src={user?.photoURL} alt="" />
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          <span className="truncate text-sm">{user?.name || user?.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {user?.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/settings">
            <Settings className="size-4" aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOutUser()}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContents({
  onNavigate,
  onSearch,
}: {
  onNavigate?: () => void;
  onSearch: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-5 p-3">
      <Link to="/" className="px-3 pt-3" onClick={onNavigate}>
        <Logo />
      </Link>
      <button
        type="button"
        onClick={onSearch}
        className="flex min-h-10 items-center gap-2.5 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-edge transition-colors duration-150 hover:border-input hover:text-foreground"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem]">
          {SHORTCUT}
        </kbd>
      </button>
      <NavItems onNavigate={onNavigate} />
      <div className="mt-auto space-y-2">
        <UsageMeter />
        <div className="flex items-center gap-1">
          <UserMenu />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

export default function AppShell() {
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.ui.mobileNavOpen);
  const navigating = useNavigation().state === 'loading';
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setSearching((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeNav = () => dispatch(mobileNavToggled(false));
  const openSearch = () => {
    closeNav();
    setSearching(true);
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {navigating && (
        <div
          role="progressbar"
          aria-label="Loading page"
          className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-signal"
        />
      )}

      <aside className="hidden w-64 shrink-0 border-r lg:block">
        <SidebarContents onSearch={openSearch} />
      </aside>

      <Sheet open={open} onOpenChange={(value) => dispatch(mobileNavToggled(value))}>
        <SheetContent side="left" className="w-72 bg-background p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContents onNavigate={closeNav} onSearch={openSearch} />
        </SheetContent>
      </Sheet>

      <CommandPalette open={searching} onOpenChange={setSearching} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Open navigation"
            onClick={() => dispatch(mobileNavToggled(true))}
          >
            <Menu className="size-5" aria-hidden />
          </Button>
          <Link to="/app">
            <Logo />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-11"
            aria-label="Search"
            onClick={openSearch}
          >
            <Search className="size-5" aria-hidden />
          </Button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto lg:my-2 lg:mr-2 lg:rounded-xl lg:border lg:bg-card/40 lg:shadow-edge">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
