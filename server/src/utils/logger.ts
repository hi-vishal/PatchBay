import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'authorization',
      'password',
      'token',
      'secret',
      'apiKey',
      'encryptedAuth',
      'encryptedKey',
      'auth',
      '*.authorization',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.encryptedAuth',
      '*.encryptedKey',
      '*.auth',
    ],
    censor: '[redacted]',
  },
});
