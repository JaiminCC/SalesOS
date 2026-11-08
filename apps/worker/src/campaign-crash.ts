import { createPrismaClient, processCampaignJob, type CampaignPause } from '@salesos/database';
import type { CampaignJobName } from '@salesos/shared';

async function main(): Promise<void> {
  const [tenantId, runId, pause] = process.argv.slice(2);
  const userId = process.env.SALESOS_CAMPAIGN_USER;
  const workerUrl = process.env.DATABASE_URL_WORKER;
  const kind = (process.env.SALESOS_CAMPAIGN_KIND || 'campaign.simulation.run') as CampaignJobName;
  if (!tenantId || !runId || !userId || !workerUrl) process.exit(2);
  const prisma = createPrismaClient(workerUrl);
  await processCampaignJob(prisma, { tenantId, runId, userId, kind, pause: pause as CampaignPause });
  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'campaign crash failed');
  process.exit(2);
});
