import { api } from '@/lib/api';
import type { McpServer, McpServerInput, McpTestResult } from '@/lib/types';

const mcpApi = api.injectEndpoints({
  endpoints: (build) => ({
    listMcpServers: build.query<McpServer[], void>({
      query: () => '/mcp-servers',
      transformResponse: (response: { items: McpServer[] }) => response.items,
      providesTags: ['McpServer'],
    }),
    createMcpServer: build.mutation<McpServer, McpServerInput>({
      query: (body) => ({ url: '/mcp-servers', method: 'POST', body }),
      transformResponse: (response: { server: McpServer }) => response.server,
      invalidatesTags: ['McpServer', 'Me'],
    }),
    updateMcpServer: build.mutation<McpServer, { id: string; changes: Partial<McpServerInput> }>({
      query: ({ id, changes }) => ({ url: `/mcp-servers/${id}`, method: 'PATCH', body: changes }),
      transformResponse: (response: { server: McpServer }) => response.server,
      invalidatesTags: ['McpServer'],
    }),
    deleteMcpServer: build.mutation<void, string>({
      query: (id) => ({ url: `/mcp-servers/${id}`, method: 'DELETE' }),
      invalidatesTags: ['McpServer', 'Me', 'Agent'],
    }),
    testMcpServer: build.mutation<McpTestResult, string>({
      query: (id) => ({ url: `/mcp-servers/${id}/test`, method: 'POST', body: {} }),
      invalidatesTags: ['McpServer'],
    }),
  }),
});

export const {
  useListMcpServersQuery,
  useCreateMcpServerMutation,
  useUpdateMcpServerMutation,
  useDeleteMcpServerMutation,
  useTestMcpServerMutation,
} = mcpApi;
