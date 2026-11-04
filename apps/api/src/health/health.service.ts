import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';

export type ReadyReport = {
  status: 'ready';
  postgres: 'up' | 'down';
  redis: 'up' | 'down';
};

@Injectable()
export class HealthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  live(): { status: 'live' } {
    return { status: 'live' };
  }

  async ready(): Promise<ReadyReport> {
    const postgres = await this.database.ping().then(
      () => 'up' as const,
      () => 'down' as const,
    );
    const redis = await this.redis.ping().then(
      () => 'up' as const,
      () => 'down' as const,
    );
    return { status: 'ready', postgres, redis };
  }
}
