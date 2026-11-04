import 'reflect-metadata';
import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AppConfig } from './config/app-config';
import { logInfo } from './logging/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const config = app.get(AppConfig);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: config.env.WEB_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  });
  await app.listen(config.env.API_PORT, config.env.API_HOST);
  logInfo('api listening', { host: config.env.API_HOST, port: config.env.API_PORT });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'api failed to start';
  process.stderr.write(`${JSON.stringify({ level: 'error', message })}\n`);
  process.exit(1);
});
