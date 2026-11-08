import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { consumeFixedWindow } from './redis.service';

describe.skipIf(!process.env.REDIS_URL)('WhatsApp webhook rate limit', () => {
  it('bounds a hashed source key and fails closed when Redis is unreachable', async () => {
    const client = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1, lazyConnect: true });
    const body = 'private inbound text must not become a key';
    const key = `wa:webhook:${createHash('sha256').update(`limit-${randomUUID()}`).digest('hex')}`;
    try {
      expect(key).not.toContain(body);
      expect(await consumeFixedWindow(client, key, 2, 60)).toBe('ALLOW');
      expect(await consumeFixedWindow(client, key, 2, 60)).toBe('ALLOW');
      expect(await consumeFixedWindow(client, key, 2, 60)).toBe('LIMITED');
      expect(await client.get(key)).toBe('3');
      expect(await client.ttl(key)).toBeGreaterThan(0);
    } finally {
      await client.del(key);
      await client.quit();
    }
    const dead = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 1, connectTimeout: 200, lazyConnect: true, retryStrategy: () => null });
    dead.on('error', () => undefined);
    expect(await consumeFixedWindow(dead, key, 2, 60)).toBe('UNAVAILABLE');
    dead.disconnect();
  });
});
