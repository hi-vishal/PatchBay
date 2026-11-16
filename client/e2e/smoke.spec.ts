import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function signIn(page: Page, next = '/app'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe.configure({ mode: 'serial' });

// A reused dev server may hold state from an earlier run.
test.beforeAll(async ({ request }) => {
  await request.post('/api/__reset');
});

test('the landing page explains the product and shows pricing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Wire your');
  await expect(page.getByRole('link', { name: 'Start free' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toBeVisible();
  await expect(page.getByText('2,000 chat messages a month')).toBeVisible();
});

test('the sample run plays through the steps timeline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'What is 18% of ₹2,40,000?' }).click();
  await expect(page.getByText('18% of ₹2,40,000 is ₹43,200.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Agent steps' })).toContainText('calculator');
});

test('protected pages send anonymous visitors to sign in, then back', async ({ page }) => {
  await page.goto('/app/agents');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fagents/);

  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/agents$/);
  await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible();
});

test('a wrong password shows a useful error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('do not match');
  await expect(page).toHaveURL(/\/login/);
});

test('a login link cannot redirect to another site', async ({ page }) => {
  await signIn(page, 'https://evil.example.com');
  await expect(page).toHaveURL(/\/app$/);
});

test('chat streams a reply and saves it', async ({ page }) => {
  await signIn(page, '/app/chat');
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello there');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');

  await expect(page.getByText('The answer is')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/chat\/\w+/);

  await page.reload();
  await expect(page.getByText('You said "Hello there".')).toBeVisible();
});

test('an agent chat shows its tool calls, collapsed until opened', async ({ page }) => {
  await signIn(page, '/app/agents');
  await page.getByRole('main').getByRole('link', { name: 'Chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Use your tools');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');

  // While the reply runs the steps are open, so the reader can follow along.
  const step = page.getByRole('button', { name: /calculator/ });
  await expect(step).toBeVisible();
  await expect(page.getByText('The answer is')).toBeVisible();

  // The saved reply folds them to one line.
  const summary = page.getByRole('button', { name: 'Used 1 tool' });
  await expect(summary).toBeVisible();
  await expect(step).toBeHidden();

  await summary.click();
  await expect(page.getByText('"expression"')).toBeHidden();
  await step.click();
  await expect(page.getByText('"expression"')).toBeVisible();
});

async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message' }).fill(message);
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
}

test('a reply that fails partway shows once, and retrying replaces it', async ({ page }) => {
  await signIn(page, '/app/chat');
  await send(page, 'fail partway please');
  const thread = page.getByRole('log');

  await expect(page.getByRole('alert').getByText('This reply did not finish')).toBeVisible();
  await expect(thread.getByText('Half a reply')).toHaveCount(1);
  await expect(thread.getByText('fail partway please', { exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(thread.getByText('The answer is')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(thread.getByText('Half a reply')).toHaveCount(0);
  await expect(thread.getByText('fail partway please', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.reload();
  await expect(thread.getByText('The answer is')).toBeVisible();
  await expect(thread.getByText('fail partway please', { exact: true })).toHaveCount(1);
});

test('a message the server never accepted stays on screen and can be retried', async ({ page }) => {
  await signIn(page, '/app/chat');
  await send(page, 'fail before answering');
  const thread = page.getByRole('log');

  await expect(page.getByRole('alert').getByText('No API key is set.')).toBeVisible();
  await expect(thread.getByText('fail before answering', { exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(thread.getByText('The answer is')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/chat\/\w+/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(thread.getByText('fail before answering', { exact: true })).toHaveCount(1);
});

test('stopping keeps the reply so far, and retrying replaces it', async ({ page }) => {
  await signIn(page, '/app/chat');
  await send(page, 'answer slowly');
  const thread = page.getByRole('log');

  await expect(thread.getByText(/word3/)).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();

  await expect(page.getByText('You stopped this reply.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  // Once the stopped reply is saved, it replaces the live copy instead of joining it.
  await expect(thread.getByText(/word3/)).toHaveCount(1);
  await page.waitForTimeout(800);
  await expect(thread.getByText(/word3/)).toHaveCount(1);
  await expect(thread.getByText('answer slowly', { exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(thread.getByText('The answer is')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(thread.getByText(/word3/)).toHaveCount(0);
  await expect(page.getByText('You stopped this reply.')).toHaveCount(0);
});

test('"New chat" leaves a chat whose reply failed', async ({ page }) => {
  await signIn(page, '/app/chat');
  await send(page, 'fail partway please');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/chat\/\w+/);

  await page.getByRole('button', { name: 'New chat' }).click();

  await expect(page).toHaveURL(/\/app\/chat$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('log').getByText('Half a reply')).toHaveCount(0);
});

test('code in a reply is highlighted and can be copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, '/app/chat');
  await send(page, 'show code');
  const thread = page.getByRole('log');

  await expect(thread.locator('pre .hljs-keyword').getByText('const')).toBeVisible();
  await expect(thread.getByText('ts', { exact: true })).toBeVisible();

  await thread.getByRole('button', { name: 'Copy code' }).click();
  await expect(thread.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('const answer = 42;');
});

/** Holds a request for a moment, so a test can see the page before the server answers. */
function holdThenFail(page: Page, url: string, method: string) {
  return page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return route.fulfill({
      status: 500,
      json: { error: { code: 'INTERNAL', message: 'The server had a problem.' } },
    });
  });
}

test('renaming a chat shows at once and goes back if the save fails', async ({ page }) => {
  await signIn(page, '/app/chat');
  const list = page.getByRole('list', { name: 'Chats' });
  const original = 'Why did Tuesday’s deploy fail?';
  await expect(list.getByText(original)).toBeVisible();
  await holdThenFail(page, '**/api/conversations/*', 'PATCH');

  await list.getByRole('button', { name: `Options for ${original}` }).click({ force: true });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Deploy failure');
  await page.getByRole('button', { name: 'Save name' }).click();

  await expect(list.getByText('Deploy failure')).toBeVisible({ timeout: 300 });

  await expect(list.getByText(original)).toBeVisible();
  await expect(page.getByText(/Could not rename this chat/)).toBeVisible();
});

test('deleting a chat removes it at once and brings it back if that fails', async ({ page }) => {
  await signIn(page, '/app/chat');
  const list = page.getByRole('list', { name: 'Chats' });
  const original = 'Why did Tuesday’s deploy fail?';
  await expect(list.getByText(original)).toBeVisible();
  await holdThenFail(page, '**/api/conversations/*', 'DELETE');

  await list.getByRole('button', { name: `Options for ${original}` }).click({ force: true });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete chat' }).click();

  await expect(list.getByText(original)).toHaveCount(0, { timeout: 300 });

  await expect(list.getByText(original)).toBeVisible();
  await expect(page.getByText(/Could not delete this chat/)).toBeVisible();
});

test('an agent can be built and tested on the same page', async ({ page }) => {
  await signIn(page, '/app/agents/new');
  const panel = page.getByRole('region', { name: 'Test this agent' });
  await expect(panel.getByText('Create the agent, then test it right here.')).toBeVisible();

  await page.getByLabel('Name').fill('Math helper');
  await page.getByLabel('Description').fill('Does sums.');
  await page.getByLabel('Instructions').fill('Answer with numbers.');
  await page.getByRole('checkbox', { name: /Calculator/ }).check();
  await page.getByRole('checkbox', { name: /GitHub/ }).check();
  await page.getByRole('button', { name: 'Create agent' }).click();

  await expect(page).toHaveURL(/\/app\/agents\/\w+$/);
  await expect(page.getByRole('checkbox', { name: /Calculator/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /GitHub/ })).toBeChecked();

  await panel.getByRole('textbox', { name: 'Message' }).fill('What is 6 times 7?');
  await panel.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(panel.getByRole('button', { name: /calculator/ })).toBeVisible();
  await expect(panel.getByText('The answer is')).toBeVisible();

  // The test chat uses the saved agent, and says so while edits are unsaved.
  const notice = panel.getByText('This chat uses the last saved version.');
  await expect(notice).toHaveCount(0);
  await page.getByLabel('Description').fill('Does harder sums.');
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(notice).toHaveCount(0);

  await panel.getByRole('button', { name: 'New test' }).click();
  await expect(panel.getByText('The answer is')).toHaveCount(0);
  await expect(panel.getByText('Try it out here.')).toBeVisible();
});

test('"New test" clears a test chat whose reply failed', async ({ page }) => {
  await signIn(page, '/app/agents');
  await page
    .getByRole('article')
    .filter({ hasText: 'Release helper' })
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Test this agent' });

  await panel.getByRole('textbox', { name: 'Message' }).fill('fail partway please');
  await panel.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(panel.getByRole('alert')).toBeVisible();

  await panel.getByRole('button', { name: 'New test' }).click();

  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByText('Half a reply')).toHaveCount(0);
  await expect(panel.getByText('Try it out here.')).toBeVisible();
});

test('the agent form explains when its MCP servers cannot load', async ({ page }) => {
  await page.route('**/api/mcp-servers', (route) =>
    route.fulfill({
      status: 500,
      json: { error: { code: 'INTERNAL', message: 'The server had a problem.' } },
    }),
  );
  await signIn(page, '/app/agents/new');

  await expect(page.getByText('This could not be loaded')).toBeVisible();

  await page.unroute('**/api/mcp-servers');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('checkbox', { name: /GitHub/ })).toBeVisible();
});

test('saving an agent shows at once and goes back if the save fails', async ({ page }) => {
  await signIn(page, '/app/agents');
  await page
    .getByRole('article')
    .filter({ hasText: 'Release helper' })
    .getByRole('link', { name: 'Edit', exact: true })
    .click();
  await expect(page.getByLabel('Name')).toHaveValue('Release helper');
  await holdThenFail(page, '**/api/agents/*', 'PATCH');

  await page.getByLabel('Name').fill('Release writer');
  await page.getByRole('button', { name: 'Save changes' }).click();

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Release writer', { timeout: 300 });

  await expect(heading).toHaveText('Release helper');
  await expect(page.getByText('The server had a problem.')).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Release writer');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
});

test('deleting an agent removes it at once and brings it back if that fails', async ({ page }) => {
  await signIn(page, '/app/agents');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Release helper' })).toBeVisible();
  await holdThenFail(page, '**/api/agents/*', 'DELETE');

  await page.getByRole('button', { name: 'Delete Release helper' }).click();
  await page.getByRole('button', { name: 'Delete agent' }).click();

  await expect(main.getByRole('heading', { name: 'Release helper' })).toHaveCount(0, {
    timeout: 300,
  });

  await expect(main.getByRole('heading', { name: 'Release helper' })).toBeVisible();
  await expect(page.getByText(/Could not delete Release helper/)).toBeVisible();
});

test('a workflow runs, waits for approval, and finishes', async ({ page }) => {
  await signIn(page, '/app/workflows');
  await page.getByRole('link', { name: /Triage new bug reports/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Input').fill('Login page crashes');
  await page.getByRole('button', { name: 'Start run' }).click();

  await expect(page.getByText('Needs approval')).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Finished')).toBeVisible();
});

test('hitting a plan limit explains it and links to billing', async ({ page }) => {
  await signIn(page, '/app/mcp');
  await page.getByRole('button', { name: 'Add server' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Slack');
  await dialog.getByLabel('Server URL').fill('https://mcp.example.com/slack');
  await dialog.getByRole('button', { name: 'Add server' }).click();

  await expect(dialog.getByText('You have reached your plan limit')).toBeVisible();
  await dialog.getByRole('link', { name: 'See plans' }).click();
  await expect(page).toHaveURL(/\/app\/billing$/);
});

/** Changes the account the page sees, without touching the mock's own state. */
function editAccount(page: Page, edit: (account: Record<string, unknown>) => void) {
  return page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    const account = (await response.json()) as Record<string, unknown>;
    edit(account);
    return route.fulfill({ response, json: account });
  });
}

test('a payment Razorpay is still confirming does not claim Pro', async ({ page }) => {
  await page.route('**/api/billing/verify', (route) =>
    route.fulfill({
      json: {
        subscription: {
          id: 'subscription-1',
          razorpaySubscriptionId: 'sub_e2e',
          planId: 'plan_e2e',
          status: 'created',
        },
      },
    }),
  );
  await signIn(page, '/app/billing');
  await page.getByRole('button', { name: 'Upgrade to Pro' }).click();

  await expect(page.getByText(/still confirming your payment/)).toBeVisible();
  await expect(page.getByText('You are on Pro now')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Free plan' })).toBeVisible();
});

test('a payment this page missed shows up when upgrading again', async ({ page }) => {
  let paid = false;
  await page.route('**/api/billing/subscribe', (route) => {
    paid = true;
    return route.fulfill({
      status: 409,
      json: { error: { code: 'CONFLICT', message: 'You already have an active subscription.' } },
    });
  });
  await editAccount(page, (account) => {
    if (paid) (account.user as { plan: string }).plan = 'pro';
  });
  await signIn(page, '/app/billing');
  await page.getByRole('button', { name: 'Upgrade to Pro' }).click();

  await expect(page.getByText('You already have an active subscription.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pro plan' })).toBeVisible();
});

test('a failed renewal says what happens next and how to replace it', async ({ page }) => {
  await editAccount(page, (account) => {
    account.subscription = {
      id: 'subscription-1',
      razorpaySubscriptionId: 'sub_old',
      planId: 'plan_e2e',
      status: 'pending',
    };
  });
  await signIn(page, '/app/billing');

  await expect(page.getByText('Your last payment did not go through')).toBeVisible();
  await expect(page.getByText(/upgrade again\. That cancels this subscription/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeEnabled();
});

test('upgrading moves the account to Pro', async ({ page }) => {
  await signIn(page, '/app/billing');
  await expect(page.getByText(/test mode, so no real money moves/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Razorpay test card' })).toHaveAttribute(
    'href',
    /razorpay\.com/,
  );
  await page.getByRole('button', { name: 'Upgrade to Pro' }).click();
  await expect(page.getByRole('heading', { name: 'Pro plan' })).toBeVisible();
  await expect(page.getByText(/Renews on/)).toBeVisible();
});

test('an API key saved in Settings is not shown again', async ({ page }) => {
  await signIn(page, '/app/settings');
  const key = page.getByLabel('API key');
  await key.fill('sk-or-e2e-secret-1234');
  await page.getByLabel('Model name').fill('vendor/fast:free');
  await page.getByRole('button', { name: 'Save OpenRouter' }).click();

  await expect(page.getByText('OpenRouter saved')).toBeVisible();
  await expect(key).toHaveValue('');
  await expect(key).toHaveAttribute('placeholder', /ending 1234/);
});

test('free OpenRouter models can be switched in chat, even mid-conversation', async ({ page }) => {
  await signIn(page, '/app/chat');
  const message = page.getByRole('textbox', { name: 'Message' });
  const modelMenu = page.getByRole('combobox', { name: 'Model' });

  await modelMenu.click();
  await expect(page.getByRole('group', { name: 'OpenRouter' })).toBeVisible();
  await page.getByRole('option', { name: 'Vendor: Fast' }).click();

  await message.fill('Hello there');
  await message.press('Enter');
  await expect(page).toHaveURL(/\/app\/chat\/\w+/);
  await expect(page.getByText('The answer is')).toBeVisible();

  await expect(modelMenu).toContainText('Vendor: Fast');
  await modelMenu.click();
  await page.getByRole('option', { name: 'Vendor: Plain' }).click();
  await expect(modelMenu).toContainText('Vendor: Plain');
});

test('the Ollama guide shows the connection and how to set it up', async ({ page }) => {
  await signIn(page, '/app/settings');
  await page.getByRole('button', { name: /^Ollama/ }).click();
  await page.getByLabel('Public Ollama address').fill('http://localhost:11434');
  await page.getByRole('button', { name: 'Save Ollama' }).click();
  await expect(page.getByText('Settings only accepts public addresses.')).toBeVisible();

  await page.getByRole('link', { name: 'Open the Ollama guide' }).click();
  await expect(page.getByRole('heading', { name: 'Use local models with Ollama' })).toBeVisible();
  await expect(page.getByText('Ollama is not connected yet')).toBeVisible();
  await expect(page.getByText('ollama pull llama3.2')).toBeVisible();

  await page.getByRole('tab', { name: 'Docker Compose' }).click();
  await expect(page.getByText('OLLAMA_DOCKER_URL=http://host.docker.internal:11434')).toBeVisible();
});

test('a connected Ollama offers its installed models', async ({ page }) => {
  await signIn(page, '/app/settings');
  await page.getByRole('button', { name: /^Ollama/ }).click();
  await page.getByLabel('Public Ollama address').fill('https://ollama.example.com');
  await page.getByRole('button', { name: 'Save Ollama' }).click();
  await expect(page.getByText('Ollama saved')).toBeVisible();

  await page.getByRole('link', { name: 'Open the Ollama guide' }).click();
  await expect(page.getByText('Ollama is connected')).toBeVisible();

  await page.getByRole('link', { name: 'chat', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'Model' }).click();
  await expect(page.getByRole('option', { name: 'llama3.2:latest' })).toBeVisible();
});

test('signing out ends the session', async ({ page }) => {
  await signIn(page, '/app/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/);
});

test('the command palette jumps to a screen from the keyboard', async ({ page }) => {
  await signIn(page, '/app');
  // The shortcut belongs to the app shell, so wait until sign-in has landed there.
  await expect(page.getByRole('button', { name: /^Search/ })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search screens and actions' }).fill('bill');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/billing/);
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
});

test('the landing page answers common questions and compares the plans', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Do I need a card to start?').click();
  await expect(page.getByText('The free plan asks for a sign-in and nothing else')).toBeVisible();
  await expect(page.getByRole('table', { name: 'What each plan includes' })).toContainText(
    'Chat messages each month',
  );
});

test('a new account sees what is left to set up', async ({ page, request }) => {
  // Earlier tests ran a workflow, which finishes the list. Start from the seeded account.
  await request.post('/api/__reset');
  await signIn(page, '/app');
  const setup = page.getByRole('region', { name: 'Get set up' });
  await expect(setup).toContainText('3 of 4 done');
  await setup.getByRole('link', { name: 'Open workflows' }).click();
  await expect(page).toHaveURL(/\/app\/workflows/);
});
