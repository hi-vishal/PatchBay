import { Loader2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Logo } from '@/components/Logo';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signedIn } from '@/features/auth/authSlice';
import { api } from '@/lib/api';
import {
  authErrorMessage,
  isAuthConfigured,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '@/lib/auth';

type Mode = 'signin' | 'signup';

/** Only same-site paths are allowed as a return target, so a link cannot redirect off-site. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

export default function Login() {
  const dispatch = useAppDispatch();
  const { status, error: syncError } = useAppSelector((state) => state.auth);
  const [params] = useSearchParams();

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    void isAuthConfigured().then(setConfigured);
  }, []);

  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
        return;
      }
      await signUpWithEmail(name, email, password);
      // The first sync ran before the display name was set, so send the name explicitly.
      const result = await dispatch(api.endpoints.syncUser.initiate({ name }));
      if ('data' in result && result.data) dispatch(signedIn(result.data.user));
    });
  };

  const sendReset = () => {
    if (!email) {
      setError('Enter your email first, then choose Forgot password.');
      return;
    }
    void run(async () => {
      await resetPassword(email);
      setNotice(`We sent a reset link to ${email}.`);
    });
  };

  const signup = mode === 'signup';

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section
        aria-hidden
        className="rack perf relative hidden overflow-hidden border-r p-12 lg:flex lg:flex-col lg:justify-between"
      >
        <Logo />
        <svg
          viewBox="0 0 600 260"
          className="absolute top-24 -right-16 w-[660px]"
          fill="none"
          strokeLinecap="round"
        >
          <path d="M120 0c80 240 300 250 480 90" stroke="var(--border)" strokeWidth="7" />
          <path d="M0 30c120 200 260 200 380 30" stroke="var(--signal)" strokeWidth="7" />
          <circle cx="380" cy="30" r="13" fill="var(--foreground)" />
          <circle cx="380" cy="30" r="5" fill="var(--background)" />
        </svg>
        <div className="relative max-w-lg space-y-8">
          <p className="font-display text-4xl leading-[1.05] font-semibold text-balance">
            Every step your agent takes, in plain sight.
          </p>
          <ul className="space-y-3 text-muted-foreground">
            {[
              'Free to start, with every feature included',
              'Your own model key, a free model, or a local one',
              'Nothing important happens without your approval',
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span className="size-1.5 shrink-0 rounded-full bg-signal" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-6">
          <Link to="/" className="inline-block lg:hidden">
            <Logo />
          </Link>
          <div className="space-y-1">
            <h1 className="font-display text-3xl font-semibold">
              {signup ? 'Create your account' : 'Sign in'}
            </h1>
            <p className="text-muted-foreground">
              {signup ? 'The free plan needs no card.' : 'Pick up where you left off.'}
            </p>
          </div>

          {!configured && (
            <Alert tone="warning" title="Sign-in is not set up yet">
              Add the VITE_FIREBASE values to .env, then rebuild the app. The README lists each one.
            </Alert>
          )}
          {(error ?? syncError) && <Alert tone="error">{error ?? syncError}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full cursor-pointer"
            disabled={busy || !configured}
            onClick={() => void run(signInWithGoogle)}
          >
            <GoogleMark />
            Continue with Google
          </Button>

          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or use email
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-4" onSubmit={submit}>
            {signup && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-11"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {!signup && (
                  <button
                    type="button"
                    onClick={sendReset}
                    className="cursor-pointer text-sm text-link underline-offset-4 hover:underline"
                  >
                    Forgot password
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11"
              />
            </div>
            <Button
              type="submit"
              className="h-11 w-full cursor-pointer"
              disabled={busy || !configured}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {signup ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground">
            {signup ? 'Already have an account?' : 'New here?'}{' '}
            <button
              type="button"
              className="cursor-pointer text-link underline-offset-4 hover:underline"
              onClick={() => {
                setMode(signup ? 'signin' : 'signup');
                setError(null);
                setNotice(null);
              }}
            >
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          <p className="pt-4 text-xs text-muted-foreground">
            Patchbay™ is a trademark of Vishal Gupta.
          </p>
        </div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
