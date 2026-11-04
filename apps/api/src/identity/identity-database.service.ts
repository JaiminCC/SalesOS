import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@salesos/database';
import { AppConfig } from '../config/app-config';

@Injectable()
export class IdentityDatabase implements OnModuleDestroy {
  readonly prisma: PrismaClient;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.prisma = createPrismaClient(config.env.DATABASE_URL_IDENTITY);
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
