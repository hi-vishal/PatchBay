import { api } from '@/lib/api';
import type { Run, Workflow } from '@/lib/types';

type WorkflowInput = Pick<Workflow, 'name'> &
  Partial<Pick<Workflow, 'description' | 'nodes' | 'edges' | 'enabled'>>;

const workflowsApi = api.injectEndpoints({
  endpoints: (build) => ({
    listWorkflows: build.query<Workflow[], void>({
      query: () => '/workflows',
      transformResponse: (response: { items: Workflow[] }) => response.items,
      providesTags: ['Workflow'],
    }),
    getWorkflow: build.query<Workflow, string>({
      query: (id) => `/workflows/${id}`,
      transformResponse: (response: { workflow: Workflow }) => response.workflow,
      providesTags: (_result, _error, id) => [{ type: 'Workflow', id }],
    }),
    createWorkflow: build.mutation<Workflow, WorkflowInput>({
      query: (body) => ({ url: '/workflows', method: 'POST', body }),
      transformResponse: (response: { workflow: Workflow }) => response.workflow,
      invalidatesTags: ['Workflow', 'Me'],
    }),
    updateWorkflow: build.mutation<Workflow, { id: string; changes: Partial<WorkflowInput> }>({
      query: ({ id, changes }) => ({ url: `/workflows/${id}`, method: 'PATCH', body: changes }),
      transformResponse: (response: { workflow: Workflow }) => response.workflow,
      invalidatesTags: (_result, _error, { id }) => ['Workflow', { type: 'Workflow', id }],
    }),
    deleteWorkflow: build.mutation<void, string>({
      query: (id) => ({ url: `/workflows/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Workflow', 'Me'],
    }),
    runWorkflow: build.mutation<Run, { id: string; input: string }>({
      query: ({ id, input }) => ({
        url: `/workflows/${id}/run`,
        method: 'POST',
        body: { input },
      }),
      transformResponse: (response: { run: Run }) => response.run,
      invalidatesTags: ['Run', 'Me'],
    }),
    listRuns: build.query<Run[], { workflowId?: string; limit?: number } | void>({
      query: (params) => ({ url: '/runs', params: { limit: 20, ...(params ?? {}) } }),
      transformResponse: (response: { items: Run[] }) => response.items,
      providesTags: ['Run'],
    }),
    getRun: build.query<Run, string>({
      query: (id) => `/runs/${id}`,
      transformResponse: (response: { run: Run }) => response.run,
      providesTags: (_result, _error, id) => [{ type: 'Run', id }],
    }),
    resumeRun: build.mutation<Run, { id: string; approved: boolean }>({
      query: ({ id, approved }) => ({
        url: `/runs/${id}/resume`,
        method: 'POST',
        body: { approved },
      }),
      transformResponse: (response: { run: Run }) => response.run,
      invalidatesTags: (_result, _error, { id }) => ['Run', { type: 'Run', id }],
    }),
  }),
});

export const {
  useListWorkflowsQuery,
  useGetWorkflowQuery,
  useCreateWorkflowMutation,
  useUpdateWorkflowMutation,
  useDeleteWorkflowMutation,
  useRunWorkflowMutation,
  useListRunsQuery,
  useGetRunQuery,
  useResumeRunMutation,
} = workflowsApi;
