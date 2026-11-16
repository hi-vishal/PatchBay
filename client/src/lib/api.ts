import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIdToken } from '@/lib/auth';
import type { ApiErrorBody, MeResponse, User } from '@/lib/types';

export const API_BASE = `${(import.meta.env.VITE_API_URL as string | undefined) ?? ''}/api`;

/** One API definition. Each feature adds its endpoints with injectEndpoints. */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: API_BASE,
    prepareHeaders: async (headers) => {
      const token = await getIdToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: [
    'Me',
    'Agent',
    'Conversation',
    'Message',
    'McpServer',
    'Workflow',
    'Run',
    'Plan',
    'LlmSettings',
  ],
  endpoints: (build) => ({
    syncUser: build.mutation<{ user: User }, { name?: string } | void>({
      query: (body) => ({ url: '/auth/sync', method: 'POST', body: body ?? {} }),
      invalidatesTags: ['Me'],
    }),
    getMe: build.query<MeResponse, void>({
      query: () => '/me',
      providesTags: ['Me'],
    }),
  }),
});

export const { useGetMeQuery } = api;

function isFetchError(error: unknown): error is FetchBaseQueryError {
  return typeof error === 'object' && error !== null && 'status' in error;
}

export function apiErrorCode(error: unknown): string | undefined {
  if (!isFetchError(error)) return undefined;
  return (error.data as ApiErrorBody | undefined)?.error?.code;
}

/** Extracts the server's message from an RTK Query error. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong. Try again.') {
  if (isFetchError(error)) {
    if (error.status === 'FETCH_ERROR') return 'Could not reach the server. Check your connection.';
    const message = (error.data as ApiErrorBody | undefined)?.error?.message;
    if (message) return message;
  }
  return fallback;
}
