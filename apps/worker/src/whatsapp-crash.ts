import { acceptWhatsAppWebhook, createPrismaClient, processWhatsAppIngress, type WhatsAppPause } from '@salesos/database';
import { whatsAppSignature } from '@salesos/shared';

async function main(): Promise<void> {
  const pause = process.argv[2] as WhatsAppPause;
  const workerUrl = process.env.DATABASE_URL_WORKER;
  const secret = process.env.SALESOS_WHATSAPP_SECRET;
  const raw = process.env.SALESOS_WHATSAPP_BODY;
  const ingressId = process.env.SALESOS_WHATSAPP_INGRESS;
  const userId = process.env.SALESOS_WHATSAPP_USER;
  if (!workerUrl || !secret || !userId) process.exit(2);
  const prisma = createPrismaClient(workerUrl);
  if (pause === 'before-receipt' || pause === 'after-receipt') {
    const body = Buffer.from(raw ?? '', 'utf8');
    await acceptWhatsAppWebhook(prisma, { secret, raw: body, signature: whatsAppSignature(secret, body), origin: 'STUB_TESTED', pause });
  } else if (ingressId) {
    await processWhatsAppIngress(prisma, { ingressId, userId, pause });
  }
  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'whatsapp crash failed');
  process.exit(2);
});
