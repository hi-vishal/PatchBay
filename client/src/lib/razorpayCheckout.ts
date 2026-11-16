const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

export interface CheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: () => void) => void;
}

interface RazorpayOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill: { name?: string; email?: string };
  theme: { color: string };
  handler: (response: CheckoutSuccess) => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let scriptLoad: Promise<void> | null = null;

/** Razorpay requires its own hosted script, so it loads only when someone starts paying. */
function loadScript(): Promise<void> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoad = null;
      reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

export interface CheckoutRequest {
  keyId: string;
  subscriptionId: string;
  name?: string;
  email?: string;
}

/**
 * Opens Checkout. Resolves with the payment details, or null if the customer closes it. Rejects if
 * they close it after a failed payment.
 */
export async function openCheckout(request: CheckoutRequest): Promise<CheckoutSuccess | null> {
  if (!window.Razorpay) await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('Razorpay Checkout did not load. Try again.');

  return new Promise((resolve, reject) => {
    // Checkout asks the customer to try again after a failure, and a later attempt can still
    // succeed. Reporting the failure at once would lose that payment.
    let failed = false;
    const checkout = new Razorpay({
      key: request.keyId,
      subscription_id: request.subscriptionId,
      name: 'Patchbay',
      description: 'Pro plan',
      prefill: { name: request.name, email: request.email },
      theme: { color: '#2563EB' },
      handler: resolve,
      modal: {
        ondismiss: () => {
          if (failed) {
            reject(new Error('The payment did not go through. Try again or use another method.'));
          } else {
            resolve(null);
          }
        },
      },
    });
    checkout.on('payment.failed', () => {
      failed = true;
    });
    checkout.open();
  });
}
