import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { approveMeeting, confirmMeeting, createCalendarConnection, createInternalMeeting, createMeetingType, createPrismaClient, disconnectCalendar, expireHeldSlot, holdSlot, processCalendarJob, rescheduleMeeting, saveCalendarRule, submitMeeting } from '@salesos/database';
import { afterAll, describe, expect, it } from 'vitest';

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;
const workerUrl = process.env.DATABASE_URL_WORKER;

describe.skipIf(!adminUrl || !appUrl || !workerUrl)('calendar worker kill recovery', () => {
  const admin = createPrismaClient(adminUrl as string);
  const worker = createPrismaClient(workerUrl as string);
  const stamp = randomUUID().slice(0, 8);
  let tenantId = '';
  let userId = '';
  let reviewerId = '';
  let typeId = '';
  let localStart = '';
  let meetingId = '';
  let version = 0;
  let holdId = '';
  let action = 'hold';
  let nextStart = '';

  afterAll(async () => {
    if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (userId) await admin.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (reviewerId) await admin.user.delete({ where: { id: reviewerId } }).catch(() => undefined);
    await admin.$disconnect();
    await worker.$disconnect();
  });

  it('rolls back killed calendar mutations and lets one replacement finish', async () => {
    const tenant = await admin.tenant.create({ data: { name: `Kill calendar ${stamp}`, slug: `kill-cal-${stamp}` } });
    tenantId = tenant.id;
    const user = await admin.user.create({ data: { emailHmac: `kill-cal-${stamp}`, emailCiphertext: Buffer.from('k'), displayName: 'Owner', status: 'ACTIVE' } });
    const reviewer = await admin.user.create({ data: { emailHmac: `kill-review-${stamp}`, emailCiphertext: Buffer.from('k'), displayName: 'Reviewer', status: 'ACTIVE' } });
    userId = user.id;
    reviewerId = reviewer.id;
    await admin.membership.createMany({ data: [user, reviewer].map((row) => ({ tenantId, userId: row.id, status: 'ACTIVE' as const })) });
    const actor = { tenantId, userId };
    const day = nextWeekday();
    localStart = `${day}T09:00`;
    nextStart = `${day}T11:00`;
    await saveCalendarRule(worker, actor, { organizerId: userId, timeZone: 'Asia/Kolkata', workingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 })), bufferBeforeMinutes: 0, bufferAfterMinutes: 0, noticeMinutes: 0, horizonDays: 30 });
    const type = await createMeetingType(worker, actor, { name: 'Kill demo', description: '', durationMinutes: 30, locationType: 'VIRTUAL_PENDING', timeZone: 'Asia/Kolkata', approvalRequired: true, hostIds: [userId] });
    typeId = type.id;

    await killChild('before-hold');
    await killChild('during-hold');
    expect(await admin.calendarHold.count({ where: { tenantId } })).toBe(0);
    action = 'hold';
    await killChild('after-hold');
    expect(await admin.calendarHold.count({ where: { tenantId, status: 'HELD' } })).toBe(1);
    await expect(holdSlot(worker, actor, { organizerId: userId, meetingTypeId: typeId, localStart, timeZone: 'Asia/Kolkata' })).rejects.toThrow(/SLOT_CONFLICT/);

    const held = await admin.calendarHold.findFirstOrThrow({ where: { tenantId, status: 'HELD' } });
    const meeting = await createInternalMeeting(worker, actor, { holdId: held.id, title: 'Kill demo', agenda: 'Local only' });
    await submitMeeting(worker, actor, meeting.id, meeting.version);
    await approveMeeting(worker, { tenantId, userId: reviewerId }, meeting.id, meeting.version + 1);
    meetingId = meeting.id;
    version = meeting.version + 2;
    action = 'confirm';
    await killChild('during-confirm');
    expect((await admin.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId, id: meetingId } } }))?.state).toBe('APPROVED_INTERNAL');
    expect(await admin.calendarExternalLink.count({ where: { tenantId } })).toBe(0);
    await killChild('after-confirm');
    expect((await admin.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId, id: meetingId } } }))?.state).toBe('BOOKED_INTERNAL');
    expect(await admin.calendarExternalLink.count({ where: { tenantId, providerEventId: null } })).toBe(1);
    await expect(confirmMeeting(worker, actor, meetingId, version)).rejects.toThrow(/CONFLICT/);

    const booked = await admin.calendarMeeting.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: meetingId } } });
    version = booked.version;
    action = 'reschedule';
    await killChild('during-reschedule');
    const unchanged = await admin.calendarMeeting.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: meetingId } } });
    expect(unchanged.state).toBe('BOOKED_INTERNAL');
    expect(unchanged.startAt.toISOString()).toBe(booked.startAt.toISOString());
    const moved = await rescheduleMeeting(worker, actor, { meetingId, version, localStart: nextStart });
    expect(moved.externalWrite).toBe('NOT_AUTHORIZED');

    const expiring = await holdSlot(worker, actor, { organizerId: userId, meetingTypeId: typeId, localStart: `${day}T13:00`, timeZone: 'Asia/Kolkata' });
    holdId = expiring.id;
    action = 'expire';
    await killChild('during-expire');
    expect((await admin.calendarHold.findUnique({ where: { tenantId_id: { tenantId, id: holdId } } }))?.status).toBe('HELD');
    const expired = await expireHeldSlot(worker, actor, holdId);
    expect(expired.expired).toBe(1);
    const again = await processCalendarJob(worker, actor);
    expect(again).toMatchObject({ expired: 0, externalWrites: 0 });
    const duplicate = await processCalendarJob(worker, actor);
    expect(duplicate).toMatchObject({ expired: 0, externalWrites: 0 });
    expect(await admin.calendarHold.count({ where: { tenantId, id: holdId, status: 'EXPIRED' } })).toBe(1);

    const replacement = await holdSlot(worker, actor, { organizerId: userId, meetingTypeId: typeId, localStart: `${day}T14:00`, timeZone: 'Asia/Kolkata' });
    expect(replacement.status).toBe('HELD');
    await expect(holdSlot(worker, actor, { organizerId: userId, meetingTypeId: typeId, localStart: `${day}T14:00`, timeZone: 'Asia/Kolkata' })).rejects.toThrow(/SLOT_CONFLICT/);

    const connection = await createCalendarConnection(worker, actor, { provider: 'GOOGLE_CALENDAR', displayName: 'Kill' }, {});
    await admin.calendarConnection.update({ where: { tenantId_id: { tenantId, id: connection.id } }, data: { readiness: 'READ_ACCESS_VERIFIED' } });
    await disconnectCalendar(worker, actor, connection.id);
    const afterRevoke = await processCalendarJob(worker, actor);
    expect(afterRevoke.externalWrites).toBe(0);
    expect((await admin.calendarConnection.findUnique({ where: { tenantId_id: { tenantId, id: connection.id } } }))?.readiness).toBe('DISCONNECTED');

    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    await expect(processCalendarJob(worker, actor)).rejects.toThrow(/TENANT_SUSPENDED/);
    await admin.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    await admin.membership.update({ where: { tenantId_userId: { tenantId, userId } }, data: { status: 'SUSPENDED' } });
    await expect(processCalendarJob(worker, actor)).rejects.toThrow(/AUTH_REVOKED/);
    expect(await admin.calendarExternalLink.count({ where: { tenantId } })).toBe(1);
    expect((await admin.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId, id: meetingId } } }))?.state).toBe('PENDING_APPROVAL');
    expect(await admin.calendarMeeting.count({ where: { tenantId, state: 'BOOKED_INTERNAL' } })).toBe(0);
  }, 180_000);

  function killChild(pause: string): Promise<void> {
    return new Promise((done, fail) => {
      const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'src/calendar-crash.ts'), pause], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SALESOS_CALENDAR_TENANT: tenantId,
          SALESOS_CALENDAR_USER: userId,
          SALESOS_CALENDAR_TYPE: typeId,
          SALESOS_CALENDAR_START: localStart,
          SALESOS_CALENDAR_ACTION: action,
          SALESOS_CALENDAR_MEETING: meetingId,
          SALESOS_CALENDAR_VERSION: String(version),
          SALESOS_CALENDAR_HOLD: holdId,
          SALESOS_CALENDAR_NEXT: nextStart,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(output || 'checkpoint timed out')); }, 20000);
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (!output.includes('checkpoint')) return;
        clearTimeout(timer);
        child.kill('SIGKILL');
      });
      child.on('exit', () => { clearTimeout(timer); done(); });
      child.on('error', fail);
    });
  }
});

function nextWeekday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
