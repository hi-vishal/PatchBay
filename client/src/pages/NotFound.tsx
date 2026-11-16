import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md space-y-4">
        <h1 className="font-display text-3xl font-semibold">This page does not exist</h1>
        <p className="text-muted-foreground">Check the address, or head back to the start.</p>
        <Button asChild>
          <Link to="/">Go to the home page</Link>
        </Button>
      </div>
    </main>
  );
}
