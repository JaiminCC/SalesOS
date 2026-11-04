import type { PrismaClient } from '@salesos/database';
import type { Redis } from 'ioredis';
import { FOUNDATION_QUEUE } from '@salesos/shared';

export type WorkerHealth = {
  postgres: 'up' | 'down';
  redis: 'up' | 'down';
  queue: typeof FOUNDATION_QUEUE;
};

export async function readWorkerHealth(prisma: PrismaClient, redis: Redis): Promise<WorkerHealth> {
  const postgres = await prisma.$queryRaw`SELECT 1`.then(
    () => 'up' as const,
    () => 'down' as const,
  );
  const redisStatus = await redis.ping().then(
    (reply) => (reply === 'PONG' ? 'up' as const : 'down' as const),
    () => 'down' as const,
  );
  return { postgres, redis: redisStatus, queue: FOUNDATION_QUEUE };
}
