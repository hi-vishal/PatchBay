import { initializeApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);

let cachedAuth: Auth | undefined;

function auth(): Auth {
  if (!firebaseConfigured) throw new Error('Firebase is not configured');
  cachedAuth ??= getAuth(initializeApp(config));
  return cachedAuth;
}

export interface SessionUser {
  uid: string;
}

/** Calls back with the signed-in user, or null, whenever the session changes. */
export function subscribeToAuth(listener: (user: SessionUser | null) => void): () => void {
  if (!firebaseConfigured) {
    listener(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth(), (user) => listener(user ? { uid: user.uid } : null));
}

/** Returns a current ID token. Firebase refreshes it when it is close to expiry. */
export async function getIdToken(): Promise<string | null> {
  if (!firebaseConfigured) return null;
  return (await auth().currentUser?.getIdToken()) ?? null;
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth(), new GoogleAuthProvider());
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth(), email, password);
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  const { user } = await createUserWithEmailAndPassword(auth(), email, password);
  await updateProfile(user, { displayName: name });
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth(), email);
}

export async function signOutUser(): Promise<void> {
  await signOut(auth());
}
