import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSuccess } from './razorpayCheckout';
import { openCheckout } from './razorpayCheckout';

const payment: CheckoutSuccess = {
  razorpay_payment_id: 'pay_1',
  razorpay_subscription_id: 'sub_1',
  razorpay_signature: 'sig_1',
};

interface FakeOptions {
  subscription_id: string;
  handler: (response: CheckoutSuccess) => void;
  modal: { ondismiss: () => void };
}

/** Stands in for Razorpay's hosted script, which a test cannot load. */
class FakeCheckout {
  static opened: FakeCheckout[] = [];
  private failureHandler = () => {};

  constructor(readonly options: FakeOptions) {}

  on(event: string, handler: () => void) {
    if (event === 'payment.failed') this.failureHandler = handler;
  }

  open() {
    FakeCheckout.opened.push(this);
  }

  failAttempt() {
    this.failureHandler();
  }
}

function start() {
  const result = openCheckout({ keyId: 'rzp_test_key', subscriptionId: 'sub_1' });
  const checkout = FakeCheckout.opened.at(-1);
  if (!checkout) throw new Error('Checkout did not open');
  return { result, checkout };
}

describe('openCheckout', () => {
  beforeEach(() => {
    FakeCheckout.opened = [];
    window.Razorpay = FakeCheckout as unknown as typeof window.Razorpay;
  });

  afterEach(() => {
    window.Razorpay = undefined;
  });

  it('opens for the subscription and returns the payment', async () => {
    const { result, checkout } = start();
    expect(checkout.options.subscription_id).toBe('sub_1');
    checkout.options.handler(payment);
    await expect(result).resolves.toEqual(payment);
  });

  it('returns nothing when the customer closes it', async () => {
    const { result, checkout } = start();
    checkout.options.modal.ondismiss();
    await expect(result).resolves.toBeNull();
  });

  it('keeps a payment that succeeds after a failed attempt', async () => {
    const { result, checkout } = start();
    checkout.failAttempt();
    checkout.options.handler(payment);
    await expect(result).resolves.toEqual(payment);
  });

  it('reports the failure when the customer gives up after a failed attempt', async () => {
    const { result, checkout } = start();
    checkout.failAttempt();
    checkout.options.modal.ondismiss();
    await expect(result).rejects.toThrow('did not go through');
  });
});
