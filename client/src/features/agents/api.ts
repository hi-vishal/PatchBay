import { api } from '@/lib/api';
import type { Agent, AgentInput, ProvidersResponse } from '@/lib/types';

const agentsApi = api.injectEndpoints({
  endpoints: (build) => ({
    listAgents: build.query<Agent[], void>({
      query: () => '/agents',
      transformResponse: (response: { items: Agent[] }) => response.items,
      providesTags: ['Agent'],
    }),
    getAgent: build.query<Agent, string>({
      query: (id) => `/agents/${id}`,
      transformResponse: (response: { agent: Agent }) => response.agent,
      providesTags: (_result, _error, id) => [{ type: 'Agent', id }],
    }),
    createAgent: build.mutation<Agent, AgentInput>({
      query: (body) => ({ url: '/agents', method: 'POST', body }),
      transformResponse: (response: { agent: Agent }) => response.agent,
      invalidatesTags: ['Agent', 'Me'],
    }),
    updateAgent: build.mutation<Agent, { id: string; changes: Partial<AgentInput> }>({
      query: ({ id, changes }) => ({ url: `/agents/${id}`, method: 'PATCH', body: changes }),
      transformResponse: (response: { agent: Agent }) => response.agent,
      // Saved changes show at once. A failed save puts both copies back.
      async onQueryStarted({ id, changes }, { dispatch, queryFulfilled }) {
        const patches = [
          dispatch(
            agentsApi.util.updateQueryData('getAgent', id, (agent) => {
              Object.assign(agent, changes);
            }),
          ),
          dispatch(
            agentsApi.util.updateQueryData('listAgents', undefined, (agents) => {
              const agent = agents.find((item) => item.id === id);
              if (agent) Object.assign(agent, changes);
            }),
          ),
        ];
        await queryFulfilled.catch(() => {
          for (const patch of patches) patch.undo();
        });
      },
      invalidatesTags: (_result, _error, { id }) => ['Agent', { type: 'Agent', id }],
    }),
    deleteAgent: build.mutation<void, string>({
      query: (id) => ({ url: `/agents/${id}`, method: 'DELETE' }),
      // The agent leaves the list at once. A failed delete brings it back.
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          agentsApi.util.updateQueryData('listAgents', undefined, (agents) =>
            agents.filter((item) => item.id !== id),
          ),
        );
        await queryFulfilled.catch(() => patch.undo());
      },
      invalidatesTags: ['Agent', 'Me', 'Conversation'],
    }),
    getProviders: build.query<ProvidersResponse, void>({
      query: () => '/llm/providers',
      providesTags: ['LlmSettings'],
    }),
  }),
});

export const {
  useListAgentsQuery,
  useGetAgentQuery,
  useCreateAgentMutation,
  useUpdateAgentMutation,
  useDeleteAgentMutation,
  useGetProvidersQuery,
} = agentsApi;
