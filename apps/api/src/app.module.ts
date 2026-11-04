import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { RequestContextMiddleware } from './common/request-context';
import { DatabaseService } from './database/database.service';
import { HealthController, HealthProbeController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { JobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { FoundationQueue } from './jobs/queue.provider';
import { RedisService } from './redis/redis.service';

@Module({
  controllers: [HealthProbeController, HealthController, JobsController],
  providers: [AppConfig, DatabaseService, RedisService, HealthService, FoundationQueue, JobsService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
