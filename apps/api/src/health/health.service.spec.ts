import { INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { RequestContextMiddleware } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisService } from '../redis/redis.service';

describe('health controller', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: DatabaseService, useValue: { ping: async () => Promise.reject(new Error('postgres down')) } },
        { provide: RedisService, useValue: { ping: async () => Promise.reject(new Error('redis down')) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.use(new RequestContextMiddleware().use.bind(new RequestContextMiddleware()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 when dependencies are down', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('NOT_READY');
    expect(response.body.error.details.postgres).toBe('down');
    expect(response.body.error.details.redis).toBe('down');
  });
});

describe.skipIf(!process.env.DATABASE_URL_APP || !process.env.REDIS_URL)('health integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves live and ready when postgres and redis are up', async () => {
    const live = await request(app.getHttpServer()).get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body.data.status).toBe('live');
    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ status: 'ready', postgres: 'up', redis: 'up' });
  });
});
