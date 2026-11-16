import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Loads the single root .env for local runs. Tests and containers set real env vars instead. */
function loadRootEnvFile(): void {
  if (process.env.NODE_ENV === 'test') return;
  const candidates = [path.resolve(here, '../../../.env'), path.resolve(process.cwd(), '.env')];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file) process.loadEnvFile(file);
}

/** Empty strings from .env placeholders count as unset. */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  // Connections each process may hold open. A free MongoDB Atlas cluster allows 500 in total, so
  // keep WEB_CONCURRENCY x (this + the checkpointer's pool) x instances under that.
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(500).default(20),
  // API processes to run on this machine. Set it to the number of CPU cores.
  WEB_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(1),
  // Requests one address may make each minute, across all routes.
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  TRUST_PROXY: booleanString,

  ENCRYPTION_KEY: z
    .string({ error: 'ENCRYPTION_KEY is required. Generate one: openssl rand -base64 32' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      error: 'ENCRYPTION_KEY must be 32 bytes, base64 encoded. Generate: openssl rand -base64 32',
    }),

  FIREBASE_PROJECT_ID: optionalString,
  FIREBASE_CLIENT_EMAIL: optionalString,
  FIREBASE_PRIVATE_KEY: optionalString.transform((value) => value?.replace(/\\n/g, '\n')),

  OPENAI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  GOOGLE_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  OLLAMA_BASE_URL: optionalString.refine((value) => !value || URL.canParse(value), {
    error: 'OLLAMA_BASE_URL must be a URL, such as http://localhost:11434',
  }),
  DEFAULT_MODEL: z.string().default('anthropic:claude-opus-5-5'),

  MCP_ALLOW_STDIO: booleanString,
  MCP_ALLOW_PRIVATE_NETWORKS: booleanString,

  // This app takes test payments only. Going live should be a deliberate code change, not a pasted key.
  RAZORPAY_KEY_ID: optionalString.refine((value) => !value || value.startsWith('rzp_test_'), {
    error: 'RAZORPAY_KEY_ID must be a test mode key (rzp_test_...). Live payments are turned off.',
  }),
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  RAZORPAY_PRO_PLAN_ID: optionalString,
  PRO_PLAN_PRICE_LABEL: z.string().default('₹999 per month'),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  loadRootEnvFile();
  const parsed = schema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  // The logger depends on this module, so write straight to stderr. Only names and
  // validation messages appear here, never values.
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  process.stderr.write(`Invalid environment configuration:\n${problems}\n`);
  process.exit(1);
}

export const env = loadEnv();
