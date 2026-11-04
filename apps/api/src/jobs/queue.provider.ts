import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { FOUNDATION_QUEUE, type FoundationJobData } from '@salesos/shared';
import { AppConfig } from '../config/app-config';

@Injectable()
export class FoundationQueue implements OnModuleDestroy {
  readonly queue: Queue<FoundationJobData>;
  private readonly connection: IORedis;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.connection = new IORedis(config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on('error', () => undefined);
    this.queue = new Queue<FoundationJobData>(FOUNDATION_QUEUE, { connection: this.connection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    if (this.connection.status !== 'end') await this.connection.quit().catch(() => undefined);
  }
}
