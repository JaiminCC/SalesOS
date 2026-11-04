import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@salesos/database';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';

const tenantA = '11111111-1111-4111-8111-111111111111';

describe.skipIf(!process.env.DATABASE_URL_APP || !process.env.REDIS_URL || !process.env.INTERNAL_JOB_TOKEN)(
  'foundation job API',
  () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects a missing internal token and persists an accepted job', async () => {
      const denied = await request(app.getHttpServer()).post('/api/v1/jobs/foundation-ping').send({
        tenantId: tenantA,
        idempotencyKey: 'denied-key-0001',
      });
      expect(denied.status).toBe(401);

      const key = `foundation-${Date.now()}`;
      const token = app.get(AppConfig).env.INTERNAL_JOB_TOKEN;
      const created = await request(app.getHttpServer())
        .post('/api/v1/jobs/foundation-ping')
        .set('Authorization', `Bearer ${token}`)
        .send({ tenantId: tenantA, idempotencyKey: key });
      expect(created.status).toBe(202);
      expect(created.body.data.status).toBe('QUEUED');

      const replay = await request(app.getHttpServer())
        .post('/api/v1/jobs/foundation-ping')
        .set('Authorization', `Bearer ${token}`)
        .send({ tenantId: tenantA, idempotencyKey: key, mode: 'fail-once' });
      expect(replay.status).toBe(409);

      const database = app.get(DatabaseService);
      const row = await withTenant(database.prisma, tenantA, (tx) =>
        tx.jobExecution.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: tenantA, idempotencyKey: key } },
        }),
      );
      expect(row?.status).toBe('QUEUED');
    });
  },
);
