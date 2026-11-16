import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import type { User } from '@/lib/types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
}

const initialState: AuthState = { status: 'loading', user: null, error: null };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<User>) {
      state.status = 'authenticated';
      state.user = action.payload;
      state.error = null;
    },
    signedOut(state) {
      state.status = 'anonymous';
      state.user = null;
      state.error = null;
    },
    syncFailed(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.user = null;
      state.error = action.payload;
    },
  },
});

export const { signedIn, signedOut, syncFailed } = authSlice.actions;
export const authReducer = authSlice.reducer;
