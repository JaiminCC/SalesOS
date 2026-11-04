import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { foundationQueueName, type FoundationJobData, type KnowledgeJobData } from '@salesos/shared';
import { AppConfig } from '../config/app-config';

@Injectable()
export class FoundationQueue implements OnModuleDestroy {
  readonly queue: Queue<FoundationJobData | KnowledgeJobData>;
  private readonly connection: IORedis;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.connection = new IORedis(config.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      enableOfflineQueue: false,
    });
    this.connection.on('error', () => undefined);
    this.queue = new Queue<FoundationJobData | KnowledgeJobData>(foundationQueueName(config.env.SALESOS_QUEUE_PREFIX), {
      connection: this.connection,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    if (this.connection.status !== 'end') await this.connection.quit().catch(() => undefined);
  }
}
