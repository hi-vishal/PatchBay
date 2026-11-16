/**
 * Makes and manages promo codes that give unlimited use. Run it where the server's .env is:
 *
 *   npm run promo -- create --label "Me"              one code, one use, never expires
 *   npm run promo -- create --count 5 --days 30       five codes that stop working in 30 days
 *   npm run promo -- create --uses 10 --label "Team"  one code ten people can redeem
 *   npm run promo -- list
 *   npm run promo -- revoke <id>                      also takes unlimited use away again
 */
import { parseArgs } from 'node:util';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import {
  createPromoCodes,
  listPromoCodes,
  revokePromoCode,
} from '../services/billing/promoCodes.js';

const USAGE = `Usage:
  npm run promo -- create [--count N] [--uses N] [--days N] [--label TEXT]
  npm run promo -- list
  npm run promo -- revoke <id>`;

function positiveInt(name: string, value: string | undefined, max: number): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(`--${name} must be a whole number from 1 to ${max}`);
  }
  return number;
}

async function create(values: Record<string, string | undefined>): Promise<void> {
  const days = positiveInt('days', values.days, 3650);
  const codes = await createPromoCodes({
    count: positiveInt('count', values.count, 100),
    maxRedemptions: positiveInt('uses', values.uses, 10_000),
    label: values.label?.slice(0, 100),
    expiresAt: days ? new Date(Date.now() + days * 86_400_000) : undefined,
  });
  process.stdout.write(
    `\n${codes.join('\n')}\n\nSave these now. Only a hash is stored, so they cannot be shown again.\n` +
      'Redeem one on the Billing page, under "Have a promo code?".\n',
  );
}

async function list(): Promise<void> {
  const codes = await listPromoCodes();
  if (codes.length === 0) {
    process.stdout.write('No promo codes yet.\n');
    return;
  }
  const now = new Date();
  for (const code of codes) {
    const state = code.revokedAt
      ? 'revoked'
      : code.expiresAt && code.expiresAt <= now
        ? 'expired'
        : code.redeemedBy.length >= code.maxRedemptions
          ? 'used up'
          : 'active';
    const expires = code.expiresAt ? ` expires ${code.expiresAt.toISOString().slice(0, 10)}` : '';
    process.stdout.write(
      `${code._id.toString()}  ...${code.hint}  ${state.padEnd(7)}  ` +
        `${code.redeemedBy.length}/${code.maxRedemptions} used${expires}  ${code.label}\n`,
    );
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: 'string' },
      uses: { type: 'string' },
      days: { type: 'string' },
      label: { type: 'string' },
    },
  });
  const [command, id] = positionals;
  if (!command || !['create', 'list', 'revoke'].includes(command)) throw new Error(USAGE);
  if (command === 'revoke' && !id) throw new Error(USAGE);

  await connectDatabase(env.MONGODB_URI, 2);
  try {
    if (command === 'create') await create(values);
    if (command === 'list') await list();
    if (command === 'revoke' && id) {
      const result = await revokePromoCode(id).catch(() => ({ found: false, users: 0 }));
      process.stdout.write(
        result.found
          ? `Revoked. ${result.users} account(s) went back to their own plan.\n`
          : 'No promo code has that id. Run "npm run promo -- list" to see them.\n',
      );
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
