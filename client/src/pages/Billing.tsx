import { Check, Infinity as InfinityIcon, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Alert } from '@/components/Alert';
import { Meter } from '@/components/Meter';
import { ErrorState, ListSkeleton, PageContainer, PageHeader } from '@/components/PageStates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signedIn } from '@/features/auth/authSlice';
import {
  planFeatures,
  useCancelSubscriptionMutation,
  useGetPlansQuery,
  useRedeemPromoCodeMutation,
  useSubscribeMutation,
  useVerifyCheckoutMutation,
} from '@/features/billing/api';
import { api, apiErrorMessage, useGetMeQuery } from '@/lib/api';
import { formatLimit } from '@/lib/format';
import { openCheckout } from '@/lib/razorpayCheckout';
import type { MeResponse, PlanInfo } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {limit === null
            ? `${used.toLocaleString('en-IN')} used`
            : `${used.toLocaleString('en-IN')} of ${formatLimit(limit)}`}
        </span>
      </div>
      {limit !== null && (
        <Meter value={used} max={limit} label={`${label}: ${used} of ${limit}`} segments={32} />
      )}
    </div>
  );
}

function PromoCodeForm({ onRedeemed }: { onRedeemed: () => Promise<unknown> }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [redeemCode, { isLoading }] = useRedeemPromoCodeMutation();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await redeemCode(code.trim()).unwrap();
      setCode('');
      await onRedeemed();
      toast.success('Promo code redeemed. You have unlimited use now.');
    } catch (failure) {
      setError(apiErrorMessage(failure));
    }
  };

  return (
    <section aria-labelledby="promo-heading" className="panel space-y-4 p-6">
      <h2 id="promo-heading" className="font-display text-xl font-semibold">
        Have a promo code?
      </h2>
      <form onSubmit={(event) => void submit(event)} className="space-y-2">
        <Label htmlFor="promo-code">Promo code</Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="promo-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="PB-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'promo-error' : 'promo-help'}
            className="font-mono uppercase sm:max-w-sm"
          />
          <Button type="submit" variant="outline" disabled={isLoading || !code.trim()}>
            {isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Redeem code
          </Button>
        </div>
        {error ? (
          <p id="promo-error" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p id="promo-help" className="text-sm text-muted-foreground">
            A code removes every limit on this account.
          </p>
        )}
      </form>
    </section>
  );
}

function SubscriptionStatus({ me }: { me: MeResponse }) {
  const { subscription, user } = me;

  if (subscription?.status === 'pending') {
    return (
      <Alert tone="warning" title="Your last payment did not go through">
        Razorpay keeps retrying it, and Pro returns when a payment succeeds. To use another card
        now, upgrade again. That cancels this subscription and starts a new one.
      </Alert>
    );
  }
  if (subscription?.status === 'halted') {
    return (
      <Alert tone="warning" title="Razorpay stopped retrying your payment">
        To get Pro back, upgrade again. That cancels this subscription and starts a new one.
      </Alert>
    );
  }
  if (user.plan !== 'pro' || !subscription) return null;
  if (subscription.cancelAtCycleEnd) {
    return (
      <Alert tone="warning" title="Your subscription ends soon">
        You keep Pro
        {subscription.currentPeriodEnd
          ? ` until ${formatDate(subscription.currentPeriodEnd)}`
          : ' until the end of this period'}
        , then move to the free plan.
      </Alert>
    );
  }
  return (
    <p className="text-muted-foreground">
      {subscription.currentPeriodEnd
        ? `Renews on ${formatDate(subscription.currentPeriodEnd)}.`
        : 'Your subscription is active.'}
    </p>
  );
}

function PlanCard({
  plan,
  current,
  action,
}: {
  plan: PlanInfo;
  current: boolean;
  action?: React.ReactNode;
}) {
  return (
    <article
      className={cn(
        'panel flex flex-col gap-5 p-6 sm:p-7',
        current && 'border-signal ring-1 ring-signal',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">{plan.name}</h2>
        {current && <span className="text-sm font-medium text-link">Your plan</span>}
      </div>
      <p className="font-display text-xl font-semibold">{plan.price}</p>
      <p className="text-muted-foreground">{plan.description}</p>
      <ul className="space-y-2">
        {planFeatures(plan).map((feature) => (
          <li key={feature} className="flex items-center gap-2 text-sm">
            <Check className="size-4 shrink-0 text-success" aria-hidden />
            {feature}
          </li>
        ))}
      </ul>
      {action && <div className="mt-auto pt-2">{action}</div>}
    </article>
  );
}

export default function Billing() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const me = useGetMeQuery();
  const plans = useGetPlansQuery();
  const [subscribe] = useSubscribeMutation();
  const [verify] = useVerifyCheckoutMutation();
  const [cancel, cancelState] = useCancelSubscriptionMutation();
  const [upgrading, setUpgrading] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAccount = async () => {
    const result = await dispatch(api.endpoints.syncUser.initiate());
    if ('data' in result && result.data) dispatch(signedIn(result.data.user));
    return (await me.refetch()).data?.user.plan;
  };

  const upgrade = async () => {
    setUpgrading(true);
    setError(null);
    try {
      const { subscriptionId, keyId } = await subscribe().unwrap();
      const payment = await openCheckout({
        keyId,
        subscriptionId,
        name: user?.name,
        email: user?.email,
      });
      if (!payment) return;
      await verify(payment).unwrap();
      if ((await refreshAccount()) === 'pro') {
        toast.success('You are on Pro now');
      } else {
        toast.info('Razorpay is still confirming your payment. You move to Pro once it does.');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : apiErrorMessage(failure));
      // The server may have just learned of a payment this page missed, so show the plan as it is.
      await refreshAccount();
    } finally {
      setUpgrading(false);
    }
  };

  const confirmCancel = async () => {
    setConfirmingCancel(false);
    try {
      await cancel().unwrap();
      await refreshAccount();
      toast.success('Your subscription will end at the close of this period');
    } catch (failure) {
      toast.error(apiErrorMessage(failure));
    }
  };

  const isPro = me.data?.user.plan === 'pro';
  const isUnlimited = me.data?.user.plan === 'unlimited';
  const canceling = me.data?.subscription?.cancelAtCycleEnd;

  return (
    <PageContainer>
      <PageHeader title="Billing" description="Your plan, and how much of it you have used." />

      {(me.isLoading || plans.isLoading) && <ListSkeleton rows={2} className="[&>*]:h-48" />}
      {me.error && <ErrorState error={me.error} onRetry={() => void me.refetch()} />}
      {plans.error && <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />}
      {error && <Alert tone="error">{error}</Alert>}

      {me.data && (
        <section aria-label="Usage this month" className="panel space-y-4 p-6">
          <h2 className="font-display text-xl font-semibold">
            <span className="capitalize">{me.data.user.plan}</span> plan
          </h2>
          {isUnlimited ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <InfinityIcon className="size-4 shrink-0 text-signal" aria-hidden />
              Unlimited use, from a promo code. Usage is still counted below.
            </p>
          ) : (
            <SubscriptionStatus me={me.data} />
          )}
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <UsageRow
              label="Messages this month"
              used={me.data.usage.messages}
              limit={me.data.limits.messagesPerMonth}
            />
            <UsageRow
              label="Workflow runs this month"
              used={me.data.usage.runs}
              limit={me.data.limits.runsPerMonth}
            />
            <UsageRow label="Agents" used={me.data.usage.agents} limit={me.data.limits.agents} />
            <UsageRow
              label="MCP servers"
              used={me.data.usage.mcpServers}
              limit={me.data.limits.mcpServers}
            />
            <UsageRow
              label="Workflows"
              used={me.data.usage.workflows}
              limit={me.data.limits.workflows}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Monthly counts reset on the first of each month, UTC.
          </p>
        </section>
      )}

      {plans.data && me.data && (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.data.map((plan) => {
            const current = me.data?.user.plan === plan.id;
            let action: React.ReactNode;
            // Unlimited use comes from a promo code, so there is nothing to buy or cancel.
            if (plan.id === 'pro' && !isPro && !isUnlimited) {
              action = plan.available ? (
                <div className="space-y-3">
                  <Button
                    size="lg"
                    variant="signal"
                    className="h-12 w-full text-base"
                    disabled={upgrading}
                    onClick={() => void upgrade()}
                  >
                    {upgrading && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    Upgrade to Pro
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Payments are in test mode, so no real money moves. Pay with a{' '}
                    <a
                      href="https://razorpay.com/docs/payments/subscriptions/test/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-link underline underline-offset-2"
                    >
                      Razorpay test card
                    </a>
                    .
                  </p>
                </div>
              ) : (
                <Alert tone="warning">
                  Payments are not set up yet. Add the Razorpay values to .env.
                </Alert>
              );
            } else if (plan.id === 'pro' && isPro && !canceling) {
              action = (
                <Button
                  variant="outline"
                  disabled={cancelState.isLoading}
                  onClick={() => setConfirmingCancel(true)}
                >
                  Cancel subscription
                </Button>
              );
            }
            return <PlanCard key={plan.id} plan={plan} current={current} action={action} />;
          })}
        </div>
      )}

      {me.data && !isUnlimited && <PromoCodeForm onRedeemed={refreshAccount} />}

      <AlertDialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              You keep Pro until the end of the period you paid for, then move to the free plan.
              Nothing is deleted, but you cannot add more than the free limits allow.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Pro</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmCancel()}
            >
              Cancel subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
