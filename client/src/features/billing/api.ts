import { api } from '@/lib/api';
import type { CheckoutSuccess } from '@/lib/razorpayCheckout';
import type { PlanInfo, Subscription } from '@/lib/types';

export interface SubscribeResponse {
  subscriptionId: string;
  keyId: string;
}

const billingApi = api.injectEndpoints({
  endpoints: (build) => ({
    getPlans: build.query<PlanInfo[], void>({
      query: () => '/billing/plans',
      transformResponse: (response: { items: PlanInfo[] }) => response.items,
      providesTags: ['Plan'],
    }),
    subscribe: build.mutation<SubscribeResponse, void>({
      query: () => ({ url: '/billing/subscribe', method: 'POST', body: {} }),
    }),
    verifyCheckout: build.mutation<{ subscription: Subscription | null }, CheckoutSuccess>({
      query: (body) => ({ url: '/billing/verify', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    redeemPromoCode: build.mutation<{ plan: 'unlimited' }, string>({
      query: (code) => ({ url: '/billing/redeem', method: 'POST', body: { code } }),
      invalidatesTags: ['Me'],
    }),
    cancelSubscription: build.mutation<{ subscription: Subscription | null }, void>({
      query: () => ({ url: '/billing/cancel', method: 'POST', body: {} }),
      invalidatesTags: ['Me'],
    }),
  }),
});

export const {
  useGetPlansQuery,
  useSubscribeMutation,
  useVerifyCheckoutMutation,
  useCancelSubscriptionMutation,
  useRedeemPromoCodeMutation,
} = billingApi;

/** Shown when the API cannot be reached, so the pricing section never renders empty. */
export const FALLBACK_PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: '₹0',
    description: 'Try every feature with low limits.',
    available: true,
    limits: { messagesPerMonth: 50, runsPerMonth: 20, agents: 2, mcpServers: 1, workflows: 2 },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '₹999 per month',
    description: 'For agents you run every day.',
    available: true,
    limits: {
      messagesPerMonth: 2000,
      runsPerMonth: 500,
      agents: 50,
      mcpServers: 20,
      workflows: 50,
    },
  },
];

export function planFeatures(plan: PlanInfo): string[] {
  const { limits } = plan;
  return [
    `${limits.messagesPerMonth.toLocaleString('en-IN')} chat messages a month`,
    `${limits.runsPerMonth.toLocaleString('en-IN')} workflow runs a month`,
    `${limits.agents} agents`,
    `${limits.mcpServers} MCP ${limits.mcpServers === 1 ? 'server' : 'servers'}`,
    `${limits.workflows} workflows`,
  ];
}
