import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { RequestContextMiddleware } from './common/request-context';
import { DatabaseService } from './database/database.service';
import { HealthController, HealthProbeController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { CsrfMiddleware } from './identity/csrf.middleware';
import { AuthController } from './identity/auth.controller';
import { IdentityDatabase } from './identity/identity-database.service';
import { IdentityService } from './identity/identity.service';
import { OrganizationsController } from './identity/organizations.controller';
import { JobsController } from './jobs/jobs.controller';
import { ManagementController } from './management/management.controller';
import { NavigationController } from './navigation/navigation.controller';
import { NavigationService } from './navigation/navigation.service';
import { ProductDefaultsController, ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { JobsService } from './jobs/jobs.service';
import { FoundationQueue } from './jobs/queue.provider';
import { RedisService } from './redis/redis.service';

@Module({
  controllers: [HealthProbeController, HealthController, JobsController, AuthController, OrganizationsController, ProductsController, ProductDefaultsController, NavigationController, ManagementController],
  providers: [AppConfig, DatabaseService, RedisService, HealthService, FoundationQueue, JobsService, IdentityDatabase, IdentityService, CsrfMiddleware, ProductsService, NavigationService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, CsrfMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
