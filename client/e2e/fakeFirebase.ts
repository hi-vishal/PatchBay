/** Stands in for src/lib/firebase.ts in the e2e build. The session lives in localStorage. */
const SESSION_KEY = 'e2e-session';

export const firebaseConfigured = true;

export interface SessionUser {
  uid: string;
}

const listeners = new Set<(user: SessionUser | null) => void>();

function current(): SessionUser | null {
  return localStorage.getItem(SESSION_KEY) ? { uid: 'e2e-user' } : null;
}

function notify(): void {
  for (const listener of listeners) listener(current());
}

export function subscribeToAuth(listener: (user: SessionUser | null) => void): () => void {
  listeners.add(listener);
  listener(current());
  return () => listeners.delete(listener);
}

export async function getIdToken(): Promise<string | null> {
  return current() ? 'e2e-token' : null;
}

async function signIn(): Promise<void> {
  localStorage.setItem(SESSION_KEY, '1');
  notify();
}

export async function signInWithGoogle(): Promise<void> {
  await signIn();
}

export async function signInWithEmail(_email: string, password: string): Promise<void> {
  if (password === 'wrong-password') {
    throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
  }
  await signIn();
}

export async function signUpWithEmail(): Promise<void> {
  await signIn();
}

export async function resetPassword(): Promise<void> {}

export async function signOutUser(): Promise<void> {
  localStorage.removeItem(SESSION_KEY);
  notify();
}
