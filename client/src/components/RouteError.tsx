import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function RouteError() {
  const error = useRouteError();
  // A stale tab can ask for a chunk that a new deploy removed. Reloading fixes that.
  const chunkFailed = error instanceof TypeError && /dynamically imported/i.test(error.message);
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md space-y-4">
        <h1 className="font-display text-2xl font-semibold">
          {notFound ? 'This page does not exist' : 'This page failed to load'}
        </h1>
        <p className="text-muted-foreground">
          {chunkFailed
            ? 'A newer version of the app is available. Reload to get it.'
            : 'Reload the page. If it keeps happening, go back to the dashboard.'}
        </p>
        <div className="flex gap-3">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="outline" asChild>
            <Link to="/app">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
