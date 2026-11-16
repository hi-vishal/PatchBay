import type { AppStore } from '@/app/store';
import { signedIn, signedOut, syncFailed } from '@/features/auth/authSlice';
import { api, apiErrorMessage } from '@/lib/api';
import { subscribeToAuth } from '@/lib/auth';

/** Keeps the store in step with the Firebase session, and syncs the Mongo user on sign-in. */
export function startAuthListener(store: AppStore): void {
  const sync = async () => {
    const result = await store.dispatch(api.endpoints.syncUser.initiate());
    if ('data' in result && result.data) {
      store.dispatch(signedIn(result.data.user));
    } else {
      store.dispatch(
        syncFailed(apiErrorMessage(result.error, 'Could not load your account. Try again.')),
      );
    }
  };

  void subscribeToAuth((user) => {
    if (user) {
      void sync();
      return;
    }
    store.dispatch(signedOut());
    // One account's cached data must not be visible to the next.
    store.dispatch(api.util.resetApiState());
  }).catch(() => {
    store.dispatch(syncFailed('Could not load the sign-in service. Reload the page to try again.'));
  });
}
