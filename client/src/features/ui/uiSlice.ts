import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import type { ModelConfig } from '@/lib/types';

export type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'patchbay-theme';

function storedTheme(): Theme {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** Applies a theme to the document. index.html runs the same logic before first paint. */
export function applyTheme(theme: Theme): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && prefersDark),
  );
}

interface UiState {
  theme: Theme;
  mobileNavOpen: boolean;
  /** The model picked in chat. It lasts until reload, and Settings holds the saved default. */
  chatModel: ModelConfig | null;
}

const initialState: UiState = { theme: storedTheme(), mobileNavOpen: false, chatModel: null };

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    themeChanged(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
      if (action.payload === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, action.payload);
      applyTheme(action.payload);
    },
    mobileNavToggled(state, action: PayloadAction<boolean>) {
      state.mobileNavOpen = action.payload;
    },
    chatModelChosen(state, action: PayloadAction<ModelConfig>) {
      state.chatModel = action.payload;
    },
  },
});

export const { themeChanged, mobileNavToggled, chatModelChosen } = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
