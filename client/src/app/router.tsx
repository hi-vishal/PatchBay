import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { RouteError } from '@/components/RouteError';

/** Each page becomes its own chunk, so nobody downloads a screen they never open. */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({
  Component: (await load()).default,
});

export const router = createBrowserRouter([
  {
    // Shown while the first route's chunk downloads.
    hydrateFallbackElement: <FullPageSpinner label="Loading" />,
    errorElement: <RouteError />,
    children: [
      { path: '/', lazy: page(() => import('@/pages/Landing')), errorElement: <RouteError /> },
      { path: '/login', lazy: page(() => import('@/pages/Login')), errorElement: <RouteError /> },
      {
        path: '/app',
        element: <RequireAuth />,
        errorElement: <RouteError />,
        children: [
          {
            lazy: page(() => import('@/components/layout/AppShell')),
            errorElement: <RouteError />,
            children: [
              { index: true, lazy: page(() => import('@/pages/Dashboard')) },
              { path: 'chat', lazy: page(() => import('@/pages/Chat')) },
              { path: 'chat/:conversationId', lazy: page(() => import('@/pages/Chat')) },
              { path: 'agents', lazy: page(() => import('@/pages/Agents')) },
              { path: 'agents/new', lazy: page(() => import('@/pages/AgentBuilder')) },
              { path: 'agents/:agentId', lazy: page(() => import('@/pages/AgentBuilder')) },
              { path: 'workflows', lazy: page(() => import('@/pages/Workflows')) },
              { path: 'workflows/:workflowId', lazy: page(() => import('@/pages/WorkflowEditor')) },
              { path: 'mcp', lazy: page(() => import('@/pages/McpServers')) },
              { path: 'billing', lazy: page(() => import('@/pages/Billing')) },
              { path: 'settings', lazy: page(() => import('@/pages/Settings')) },
              { path: 'settings/ollama', lazy: page(() => import('@/pages/OllamaGuide')) },
            ],
          },
        ],
      },
      { path: '*', lazy: page(() => import('@/pages/NotFound')) },
    ],
  },
]);
