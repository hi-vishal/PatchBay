/**
 * Keeps the Firebase SDK in its own chunk, so it never blocks first paint. Everything else talks
 * to this module.
 */
const firebase = () => import('@/lib/firebase');

export async function isAuthConfigured(): Promise<boolean> {
  return (await firebase()).firebaseConfigured;
}

export async function getIdToken(): Promise<string | null> {
  return (await firebase()).getIdToken();
}

export async function subscribeToAuth(
  listener: (user: { uid: string } | null) => void,
): Promise<() => void> {
  return (await firebase()).subscribeToAuth(listener);
}

export async function signInWithGoogle(): Promise<void> {
  await (await firebase()).signInWithGoogle();
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await (await firebase()).signInWithEmail(email, password);
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await (await firebase()).signUpWithEmail(name, email, password);
}

export async function resetPassword(email: string): Promise<void> {
  await (await firebase()).resetPassword(email);
}

export async function signOutUser(): Promise<void> {
  await (await firebase()).signOutUser();
}

/** Turns a Firebase auth error into a sentence that says what to do next. */
export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match. Check them and try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Use a password with at least 6 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, or reset your password.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google window closed before sign-in finished. Try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in the Firebase project.';
    default:
      return 'Sign-in failed. Try again.';
  }
}
