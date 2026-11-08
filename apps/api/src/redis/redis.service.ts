import { createHash } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config';

const WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`;

export async function consumeFixedWindow(client: Redis, key: string, limit: number, seconds: number): Promise<'ALLOW' | 'LIMITED' | 'UNAVAILABLE'> {
  try {
    if (client.status === 'wait') await client.connect();
    const current = Number(await client.eval(WINDOW_SCRIPT, 1, key, String(seconds)));
    if (!Number.isFinite(current)) return 'UNAVAILABLE';
    return current > limit ? 'LIMITED' : 'ALLOW';
  } catch {
    return 'UNAVAILABLE';
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.client = new Redis(config.env.REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: true, lazyConnect: true });
    this.client.on('error', () => undefined);
  }

  consumeWhatsAppWebhook(source: string): Promise<'ALLOW' | 'LIMITED' | 'UNAVAILABLE'> {
    const digest = createHash('sha256').update(source).digest('hex');
    return consumeFixedWindow(this.client, `wa:webhook:${digest}`, 60, 60);
  }

  async ping(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
    const reply = await this.client.ping();
    if (reply !== 'PONG') throw new Error('unexpected redis reply');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') return;
    await this.client.quit().catch(() => undefined);
  }
}
