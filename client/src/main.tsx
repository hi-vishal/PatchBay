import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/router';
import { store } from '@/app/store';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { startAuthListener } from '@/features/auth/authListener';
import { applyTheme } from '@/features/ui/uiSlice';

applyTheme(store.getState().ui.theme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyTheme(store.getState().ui.theme);
});

startAuthListener(store);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </Provider>
  </StrictMode>,
);
