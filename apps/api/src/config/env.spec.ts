import { describe, expect, it } from 'vitest';
import { parseApiEnv } from './env';

const valid = {
  DATABASE_URL_APP: 'postgresql://salesos_app:password@127.0.0.1:5432/salesos',
  DATABASE_URL_IDENTITY: 'postgresql://salesos_identity:password@127.0.0.1:5432/salesos',
  DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
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

  it('refuses live email sending in test and production capture mail', () => {
    expect(() => parseApiEnv({ ...valid, NODE_ENV: 'production', MAIL_MODE: 'capture' })).toThrow(/capture/);
    expect(() => parseApiEnv({ ...valid, NODE_ENV: 'test', SALESOS_LIVE_EMAIL_SEND_ENABLED: 'true' })).toThrow(/Live email/);
    expect(() => parseApiEnv({ ...valid, NODE_ENV: 'test', SALESOS_LIVE_WHATSAPP_SEND_ENABLED: 'true' })).toThrow(/Live WhatsApp/);
    expect(parseApiEnv(valid).SALESOS_LIVE_WHATSAPP_SEND_ENABLED).toBe('false');
    expect(() => parseApiEnv({ ...valid, NODE_ENV: 'test', SALESOS_LIVE_CALENDAR_WRITE_ENABLED: 'true' })).toThrow(/Live calendar/);
    expect(parseApiEnv(valid).SALESOS_LIVE_CALENDAR_WRITE_ENABLED).toBe('false');
    expect(parseApiEnv(valid).SALESOS_LIVE_EMAIL_SEND_ENABLED).toBe('false');
    expect(parseApiEnv(valid).SALESOS_CAPTURE_WEBHOOK_ENABLED).toBe('false');
    expect(() => parseApiEnv({ ...valid, NODE_ENV: 'production', MAIL_MODE: 'disabled', SALESOS_CAPTURE_WEBHOOK_ENABLED: 'true', SALESOS_CAPTURE_WEBHOOK_SECRET: 'x'.repeat(32) })).toThrow(/Capture webhooks/);
    expect(() => parseApiEnv({ ...valid, SALESOS_CAPTURE_WEBHOOK_ENABLED: 'true', SALESOS_CAPTURE_WEBHOOK_SECRET: 'short' })).toThrow(/32/);
  });
});
