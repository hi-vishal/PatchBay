import { api } from '@/lib/api';
import type { LlmSettings, LlmSettingsUpdate, OllamaStatus } from '@/lib/types';

const llmApi = api.injectEndpoints({
  endpoints: (build) => ({
    getLlmSettings: build.query<LlmSettings, void>({
      query: () => '/llm/settings',
      providesTags: ['LlmSettings'],
    }),
    updateLlmSettings: build.mutation<LlmSettings, LlmSettingsUpdate>({
      query: (body) => ({ url: '/llm/settings', method: 'PATCH', body }),
      invalidatesTags: ['LlmSettings'],
    }),
    getOllamaStatus: build.query<OllamaStatus, void>({
      query: () => '/llm/ollama/status',
      providesTags: ['LlmSettings'],
    }),
  }),
});

export const { useGetLlmSettingsQuery, useUpdateLlmSettingsMutation, useGetOllamaStatusQuery } =
  llmApi;
