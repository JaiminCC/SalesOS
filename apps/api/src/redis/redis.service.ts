import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.client = new Redis(config.env.REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: true, lazyConnect: true });
    this.client.on('error', () => undefined);
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
