import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { Button } from '@/components/ui/button';
import { signOutUser } from '@/lib/auth';

/** Holds protected routes until the session is known, then sends anonymous visitors to sign in. */
export function RequireAuth() {
  const { status, error } = useAppSelector((state) => state.auth);
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner label="Loading your account" />;

  if (status === 'error') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md space-y-4">
          <h1 className="font-display text-2xl font-semibold">We could not load your account</h1>
          <p className="text-muted-foreground">{error}</p>
          <div className="flex gap-3">
            <Button onClick={() => window.location.reload()}>Try again</Button>
            <Button variant="outline" onClick={() => void signOutUser()}>
              Sign out
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}
