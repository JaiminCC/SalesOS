import { confirmMeeting, createPrismaClient, expireHeldSlot, holdSlot, rescheduleMeeting, type CalendarPause } from '@salesos/database';

async function main(): Promise<void> {
  const pause = process.argv[2] as CalendarPause;
  const workerUrl = process.env.DATABASE_URL_WORKER;
  const tenantId = process.env.SALESOS_CALENDAR_TENANT;
  const userId = process.env.SALESOS_CALENDAR_USER;
  const meetingTypeId = process.env.SALESOS_CALENDAR_TYPE;
  const localStart = process.env.SALESOS_CALENDAR_START;
  const action = process.env.SALESOS_CALENDAR_ACTION ?? 'hold';
  const meetingId = process.env.SALESOS_CALENDAR_MEETING ?? '';
  const version = Number(process.env.SALESOS_CALENDAR_VERSION ?? '0');
  const holdId = process.env.SALESOS_CALENDAR_HOLD ?? '';
  const nextStart = process.env.SALESOS_CALENDAR_NEXT ?? localStart;
  if (!workerUrl || !tenantId || !userId || !meetingTypeId || !localStart) process.exit(2);
  const prisma = createPrismaClient(workerUrl);
  const actor = { tenantId, userId };
  if (action === 'confirm') await confirmMeeting(prisma, actor, meetingId, version, pause);
  else if (action === 'reschedule') await rescheduleMeeting(prisma, actor, { meetingId, version, localStart: nextStart ?? localStart }, pause);
  else if (action === 'expire') await expireHeldSlot(prisma, actor, holdId, pause);
  else await holdSlot(prisma, actor, { organizerId: userId, meetingTypeId, localStart, timeZone: 'Asia/Kolkata' }, pause);
  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'calendar crash failed');
  process.exit(2);
});
