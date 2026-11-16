/** Stands in for src/lib/razorpayCheckout.ts in the e2e build. Payment succeeds immediately. */
export interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

export async function openCheckout(request: {
  subscriptionId: string;
}): Promise<CheckoutSuccess | null> {
  return {
    razorpay_payment_id: 'pay_e2e',
    razorpay_subscription_id: request.subscriptionId,
    razorpay_signature: 'sig_e2e',
  };
}
