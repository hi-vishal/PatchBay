import { configureStore } from '@reduxjs/toolkit';
import { authReducer } from '@/features/auth/authSlice';
import { chatReducer } from '@/features/chat/chatSlice';
import { uiReducer } from '@/features/ui/uiSlice';
import { api } from '@/lib/api';

export function createStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      ui: uiReducer,
      chat: chatReducer,
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });
}

export const store = createStore();

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
