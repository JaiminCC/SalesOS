import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env';

const valid = {
  DATABASE_URL_APP: 'postgresql://salesos_app:password@127.0.0.1:5432/salesos',
  REDIS_URL: 'redis://:password@127.0.0.1:6379',
  WEB_ORIGIN: 'http://localhost:3000',
  INTERNAL_JOB_TOKEN: 'change-me-internal-job-token',
};

describe('parseApiEnv', () => {
  it('accepts a complete environment', () => {
    expect(parseApiEnv(valid).API_PORT).toBe(3001);
  });

  it('rejects a missing database url', () => {
    expect(() => parseApiEnv({ ...valid, DATABASE_URL_APP: '' })).toThrow();
  });

  it('rejects a short internal token', () => {
    expect(() => parseApiEnv({ ...valid, INTERNAL_JOB_TOKEN: 'short' })).toThrow();
  });
});
