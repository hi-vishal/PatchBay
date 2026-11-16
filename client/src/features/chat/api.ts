import { api } from '@/lib/api';
import type { Conversation, Message } from '@/lib/types';

export const chatApi = api.injectEndpoints({
  endpoints: (build) => ({
    listConversations: build.query<Conversation[], void>({
      query: () => '/conversations?limit=100',
      transformResponse: (response: { items: Conversation[] }) => response.items,
      providesTags: ['Conversation'],
    }),
    listMessages: build.query<Message[], string>({
      query: (id) => `/conversations/${id}/messages?limit=200`,
      transformResponse: (response: { items: Message[] }) => response.items,
      providesTags: (_result, _error, id) => [{ type: 'Message', id }],
    }),
    renameConversation: build.mutation<Conversation, { id: string; title: string }>({
      query: ({ id, title }) => ({
        url: `/conversations/${id}`,
        method: 'PATCH',
        body: { title },
      }),
      transformResponse: (response: { conversation: Conversation }) => response.conversation,
      // The new name shows at once. A failed save puts the old one back.
      async onQueryStarted({ id, title }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          chatApi.util.updateQueryData('listConversations', undefined, (conversations) => {
            const conversation = conversations.find((item) => item.id === id);
            if (conversation) conversation.title = title;
          }),
        );
        await queryFulfilled.catch(() => patch.undo());
      },
      invalidatesTags: ['Conversation'],
    }),
    deleteConversation: build.mutation<void, string>({
      query: (id) => ({ url: `/conversations/${id}`, method: 'DELETE' }),
      // The chat leaves the list at once. A failed delete brings it back.
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          chatApi.util.updateQueryData('listConversations', undefined, (conversations) =>
            conversations.filter((item) => item.id !== id),
          ),
        );
        await queryFulfilled.catch(() => patch.undo());
      },
      invalidatesTags: ['Conversation'],
    }),
  }),
});

export const {
  useListConversationsQuery,
  useListMessagesQuery,
  useRenameConversationMutation,
  useDeleteConversationMutation,
} = chatApi;
