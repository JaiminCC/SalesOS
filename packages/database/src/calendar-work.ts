import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  acceptMeetingProposal,
  calendarProviderReadiness,
  classifyMeetingIntent,
  suggestSlots,
  zonedLocalToUtc,
  type AvailabilityMode,
  type BusyWindow,
  type CalendarEnv,
  type WorkingWindow,
} from '@salesos/shared';
import { decodeEncryptionKey, encryptField } from './crypto';
import { withTenant } from './with-tenant';

export class CalendarError extends Error {
  constructor(readonly code: string, readonly status = 422) {
    super(code);
  }
}

export type Actor = { tenantId: string; userId: string };
export type CalendarPause = 'before-hold' | 'during-hold' | 'after-hold' | 'during-confirm' | 'after-confirm' | 'during-reschedule' | 'during-expire';
type Client = Prisma.TransactionClient;

export function requiredAgendaPhrase(text: string): string {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  return words.slice(0, 3).join(' ');
}

const READ_SCOPES = {
  GOOGLE_CALENDAR: 'https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  MICROSOFT_CALENDAR: 'Calendars.ReadBasic',
} as const;

export async function calendarOverview(prisma: PrismaClient, actor: Actor, env: CalendarEnv) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const [meetings, holds, requests, proposals] = await Promise.all([
      tx.calendarMeeting.count({ where: { tenantId: actor.tenantId } }),
      tx.calendarHold.count({ where: { tenantId: actor.tenantId, status: 'HELD' } }),
      tx.calendarMeeting.count({ where: { tenantId: actor.tenantId, state: 'PENDING_APPROVAL' } }),
      tx.calendarMeeting.count({ where: { tenantId: actor.tenantId, sourceKind: 'AI_PROPOSAL' } }),
    ]);
    return {
      meetings,
      openHolds: holds,
      pendingApprovals: requests,
      proposals,
      google: calendarProviderReadiness('GOOGLE_CALENDAR', env),
      microsoft: calendarProviderReadiness('MICROSOFT_CALENDAR', env),
      liveGoogle: 'NOT_CONFIGURED',
      liveMicrosoft: 'NOT_CONFIGURED',
      realFreeBusy: 'NOT_TESTED',
      externalEventCreation: 'NOT_AUTHORIZED',
      calendarInvitations: 'NOT_AUTHORIZED',
      externalConfirmations: 'NOT_AVAILABLE',
      invitationDelivery: 'NOT_AVAILABLE',
      attendeeAcceptance: 'NOT_AVAILABLE',
      providerJoins: 'NOT_AVAILABLE',
    };
  });
}

export async function createCalendarConnection(prisma: PrismaClient, actor: Actor, input: { provider: 'GOOGLE_CALENDAR' | 'MICROSOFT_CALENDAR'; displayName: string }, env: CalendarEnv) {
  const readiness = calendarProviderReadiness(input.provider, env);
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const row = await tx.calendarConnection.create({
      data: { tenantId: actor.tenantId, provider: input.provider, displayName: input.displayName, readiness, grantedScopes: READ_SCOPES[input.provider], writeEnabled: false, createdBy: actor.userId },
    });
    await audit(tx, actor, 'calendar.connection.create', row.id, readiness);
    return publicConnection(row);
  });
}

export async function listCalendarConnections(prisma: PrismaClient, actor: Actor) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const rows = await tx.calendarConnection.findMany({ where: { tenantId: actor.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map(publicConnection);
  });
}

export async function startCalendarOauth(prisma: PrismaClient, actor: Actor, input: { connectionId: string; redirectUri: string }, env: CalendarEnv, key: Buffer) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const connection = await tx.calendarConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.connectionId } } });
    if (!connection || connection.disabledAt) throw new CalendarError('NOT_FOUND', 404);
    const readiness = calendarProviderReadiness(connection.provider as 'GOOGLE_CALENDAR' | 'MICROSOFT_CALENDAR', env);
    if (readiness === 'NOT_CONFIGURED' || readiness === 'CONFIGURATION_INVALID') {
      await tx.calendarConnection.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: connection.id } }, data: { readiness } });
      return { status: readiness, authorizationUrl: null as string | null };
    }
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await tx.calendarOauthState.create({
      data: {
        tenantId: actor.tenantId,
        connectionId: connection.id,
        stateHash: sha(state),
        verifierCiphertext: new Uint8Array(encryptField(verifier, key)),
        redirectUri: input.redirectUri,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        createdBy: actor.userId,
      },
    });
    const scopes = READ_SCOPES[connection.provider as 'GOOGLE_CALENDAR' | 'MICROSOFT_CALENDAR'];
    const base = connection.provider === 'GOOGLE_CALENDAR'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
    const url = new URL(base);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', connection.provider === 'GOOGLE_CALENDAR' ? env.GOOGLE_OAUTH_CLIENT_ID! : env.MICROSOFT_OAUTH_CLIENT_ID!);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    await audit(tx, actor, 'calendar.oauth.start', connection.id, 'AUTHORIZATION_REQUIRED');
    return { status: 'AUTHORIZATION_REQUIRED' as const, authorizationUrl: url.toString() };
  });
}

export async function consumeCalendarOauth(prisma: PrismaClient, actor: Actor, input: { state: string; redirectUri: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const row = await tx.calendarOauthState.findFirst({ where: { tenantId: actor.tenantId, stateHash: sha(input.state) } });
    if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now() || row.redirectUri !== input.redirectUri || row.createdBy !== actor.userId) {
      throw new CalendarError('OAUTH_STATE_REJECTED', 409);
    }
    const consumed = await tx.calendarOauthState.updateMany({ where: { tenantId: actor.tenantId, id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new CalendarError('OAUTH_STATE_REJECTED', 409);
    await tx.calendarConnection.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.connectionId } }, data: { readiness: 'AUTHORIZATION_REQUIRED' } });
    await audit(tx, actor, 'calendar.oauth.callback', row.connectionId, 'NOT_EXCHANGED');
    return { status: 'AUTHORIZATION_REQUIRED' as const, verified: false, tokenStored: false, codeExchanged: false };
  });
}

export async function recordCalendarTokenExchange(prisma: PrismaClient, actor: Actor, input: { connectionId: string; accessToken: string; scope: string }) {
  if (/calendar\.events|calendars\.readwrite|mail\.send|gmail\.send/i.test(input.scope)) throw new CalendarError('SCOPE_MISSING', 403);
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) throw new CalendarError('NOT_CONFIGURED');
  const key = decodeEncryptionKey(encoded);
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const connection = await tx.calendarConnection.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.connectionId } } });
    if (!connection || connection.disabledAt) throw new CalendarError('NOT_FOUND', 404);
    await tx.calendarCredential.create({ data: { tenantId: actor.tenantId, connectionId: connection.id, ciphertext: new Uint8Array(encryptField(input.accessToken, key)), hint: 'encrypted' } });
    await tx.calendarConnection.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: connection.id } }, data: { readiness: 'CONNECTED_UNVERIFIED', grantedScopes: input.scope.slice(0, 500), writeEnabled: false } });
    await audit(tx, actor, 'calendar.oauth.token', connection.id, 'CONNECTED_UNVERIFIED');
    return { readiness: 'CONNECTED_UNVERIFIED' as const, verified: false, tokenStored: true };
  });
}

export async function disconnectCalendar(prisma: PrismaClient, actor: Actor, connectionId: string) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const updated = await tx.calendarConnection.updateMany({
      where: { tenantId: actor.tenantId, id: connectionId, disabledAt: null },
      data: { readiness: 'DISCONNECTED', disabledAt: new Date(), revocationVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw new CalendarError('NOT_FOUND', 404);
    await audit(tx, actor, 'calendar.connection.disconnect', connectionId, 'DISCONNECTED');
    return { id: connectionId, readiness: 'DISCONNECTED' };
  });
}

export async function saveCalendarRule(prisma: PrismaClient, actor: Actor, input: { organizerId: string; timeZone: string; workingHours: WorkingWindow[]; bufferBeforeMinutes: number; bufferAfterMinutes: number; noticeMinutes: number; horizonDays: number }) {
  if ('error' in zonedLocalToUtc('2026-01-15T10:00', input.timeZone)) throw new CalendarError('INVALID_TIME_ZONE');
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertHost(tx, actor.tenantId, input.organizerId);
    const row = await tx.calendarRule.create({
      data: { tenantId: actor.tenantId, organizerId: input.organizerId, timeZone: input.timeZone, workingHours: input.workingHours as Prisma.InputJsonValue, bufferBeforeMinutes: input.bufferBeforeMinutes, bufferAfterMinutes: input.bufferAfterMinutes, noticeMinutes: input.noticeMinutes, horizonDays: input.horizonDays, createdBy: actor.userId },
    });
    await audit(tx, actor, 'calendar.rule.save', row.id, input.timeZone);
    return { id: row.id, timeZone: row.timeZone };
  });
}

export async function blockCalendarDate(prisma: PrismaClient, actor: Actor, input: { organizerId: string; localDate: string; reason: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate)) throw new CalendarError('INVALID_DATE');
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertHost(tx, actor.tenantId, input.organizerId);
    const row = await tx.calendarBlockedDate.create({ data: { tenantId: actor.tenantId, organizerId: input.organizerId, localDate: new Date(`${input.localDate}T00:00:00.000Z`), reason: input.reason.slice(0, 200), createdBy: actor.userId } });
    return { id: row.id, localDate: input.localDate };
  });
}

export async function createMeetingType(prisma: PrismaClient, actor: Actor, input: { name: string; description: string; durationMinutes: number; locationType: string; timeZone: string; approvalRequired: boolean; hostIds: string[] }) {
  if ('error' in zonedLocalToUtc('2026-01-15T10:00', input.timeZone)) throw new CalendarError('INVALID_TIME_ZONE');
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const row = await tx.calendarMeetingType.create({
      data: { tenantId: actor.tenantId, name: input.name, description: input.description, durationMinutes: input.durationMinutes, locationType: input.locationType, timeZone: input.timeZone, approvalRequired: input.approvalRequired, createdBy: actor.userId },
    });
    for (const userId of input.hostIds) {
      await assertHost(tx, actor.tenantId, userId);
      await tx.calendarMeetingTypeHost.create({ data: { tenantId: actor.tenantId, meetingTypeId: row.id, userId } });
    }
    await audit(tx, actor, 'calendar.meeting_type.create', row.id, input.locationType);
    return { id: row.id, name: row.name, locationType: row.locationType, conferenceUrl: null };
  });
}

export async function listMeetingTypes(prisma: PrismaClient, actor: Actor) {
  return withTenant(prisma, actor.tenantId, async (tx) => tx.calendarMeetingType.findMany({ where: { tenantId: actor.tenantId, archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 }));
}

export async function calendarAvailability(prisma: PrismaClient, actor: Actor, input: { organizerId: string; meetingTypeId: string; fromDate: string; throughDate: string; mode: AvailabilityMode }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    if (input.mode === 'PROVIDER_VALIDATED') return { mode: 'LOCAL_ONLY' as const, status: 'NEEDS_PROVIDER_VERIFICATION' as const, slots: [] };
    const built = await slotsFor(tx, actor.tenantId, input.organizerId, input.meetingTypeId, input.fromDate, input.throughDate, 'LOCAL_ONLY');
    return { mode: 'LOCAL_ONLY' as const, status: 'READY' as const, slots: built };
  });
}

export async function holdSlot(prisma: PrismaClient, actor: Actor, input: { organizerId: string; meetingTypeId: string; localStart: string; timeZone: string }, pause?: CalendarPause) {
  await checkpoint(pause, 'before-hold');
  const converted = zonedLocalToUtc(input.localStart, input.timeZone);
  if ('error' in converted) throw new CalendarError(converted.error);
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertActor(tx, actor);
    const type = await meetingType(tx, actor.tenantId, input.meetingTypeId);
    await assertHost(tx, actor.tenantId, input.organizerId, type.id);
    const end = new Date(converted.utc.getTime() + type.durationMinutes * 60_000);
    await lockOrganizers(tx, actor.tenantId, [input.organizerId]);
    await checkpoint(pause, 'during-hold');
    await assertFree(tx, actor.tenantId, input.organizerId, converted.utc, end);
    const hold = await tx.calendarHold.create({
      data: { tenantId: actor.tenantId, organizerId: input.organizerId, meetingTypeId: type.id, startAt: converted.utc, endAt: end, timeZone: input.timeZone, status: 'HELD', expiresAt: new Date(Date.now() + 15 * 60_000), createdBy: actor.userId },
    });
    await audit(tx, actor, 'calendar.hold.create', hold.id, 'LOCAL_ONLY');
    return { id: hold.id, startAt: hold.startAt.toISOString(), endAt: hold.endAt.toISOString(), status: hold.status, availabilityMode: 'LOCAL_ONLY' as const };
  }).then(async (hold) => {
    await checkpoint(pause, 'after-hold');
    return hold;
  });
}

export async function createInternalMeeting(prisma: PrismaClient, actor: Actor, input: { holdId: string; title: string; agenda: string; leadId?: string; contactId?: string; accountId?: string; sourceKind?: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertActor(tx, actor);
    const peek = await tx.calendarHold.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.holdId } } });
    if (!peek) throw new CalendarError('NOT_FOUND', 404);
    await lockOrganizers(tx, actor.tenantId, [peek.organizerId]);
    const hold = await openHold(tx, actor.tenantId, input.holdId);
    const taken = await tx.calendarMeeting.count({ where: { tenantId: actor.tenantId, holdId: hold.id, state: { not: 'CANCELLED_INTERNAL' } } });
    if (taken > 0) throw new CalendarError('HOLD_REUSED', 409);
    await assertFree(tx, actor.tenantId, hold.organizerId, hold.startAt, hold.endAt, hold.id);
    if (input.leadId) await owned(tx.crmLead.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.leadId } } }), 'LEAD_NOT_FOUND');
    if (input.contactId) await owned(tx.crmContact.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.contactId } } }), 'CONTACT_NOT_FOUND');
    if (input.accountId) await owned(tx.crmAccount.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.accountId } } }), 'ACCOUNT_NOT_FOUND');
    const type = await meetingType(tx, actor.tenantId, hold.meetingTypeId);
    const meeting = await tx.calendarMeeting.create({
      data: {
        tenantId: actor.tenantId, meetingTypeId: type.id, organizerId: hold.organizerId, holdId: hold.id, title: input.title, agenda: input.agenda,
        startAt: hold.startAt, endAt: hold.endAt, timeZone: hold.timeZone, locationType: type.locationType, state: 'SLOT_HELD', availabilityMode: 'LOCAL_ONLY',
        leadId: input.leadId, contactId: input.contactId, accountId: input.accountId, sourceKind: input.sourceKind ?? 'MANUAL', createdBy: actor.userId,
      },
    });
    await tx.calendarActivity.create({ data: { tenantId: actor.tenantId, meetingId: meeting.id, action: 'MEETING_CREATED', actorId: actor.userId, detail: 'LOCAL_ONLY' } });
    if (input.leadId || input.accountId) {
      await tx.crmActivity.create({ data: { tenantId: actor.tenantId, leadId: input.leadId ?? null, accountId: input.accountId ?? null, kind: 'MEETING', summary: `Internal meeting ${input.title}`, actorId: actor.userId } });
    }
    await audit(tx, actor, 'calendar.meeting.create', meeting.id, 'SLOT_HELD');
    return publicMeeting(meeting);
  });
}

export async function submitMeeting(prisma: PrismaClient, actor: Actor, meetingId: string, version: number) {
  return transition(prisma, actor, meetingId, version, 'SLOT_HELD', 'PENDING_APPROVAL', 'calendar.meeting.submit');
}

export async function approveMeeting(prisma: PrismaClient, actor: Actor, meetingId: string, version: number) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: meetingId } } });
    if (!meeting || meeting.version !== version || meeting.state !== 'PENDING_APPROVAL') throw new CalendarError('CONFLICT', 409);
    if (meeting.createdBy === actor.userId) throw new CalendarError('SELF_APPROVAL', 403);
    const digest = meetingDigest(meeting);
    const prior = await tx.calendarApproval.findFirst({ where: { tenantId: actor.tenantId, meetingId, version, digest, decision: 'APPROVED' } });
    if (prior) throw new CalendarError('APPROVAL_REPLAY', 409);
    const updated = await tx.calendarMeeting.updateMany({ where: { tenantId: actor.tenantId, id: meetingId, version, state: 'PENDING_APPROVAL' }, data: { state: 'APPROVED_INTERNAL', version: { increment: 1 } } });
    if (updated.count !== 1) throw new CalendarError('CONFLICT', 409);
    await tx.calendarApproval.create({ data: { tenantId: actor.tenantId, meetingId, version, digest, decision: 'APPROVED', reviewerId: actor.userId } });
    await audit(tx, actor, 'calendar.meeting.approve', meetingId, 'APPROVED_INTERNAL');
    return { id: meetingId, state: 'APPROVED_INTERNAL', externalWrite: 'NOT_AUTHORIZED' };
  });
}

export async function confirmMeeting(prisma: PrismaClient, actor: Actor, meetingId: string, version: number, pause?: CalendarPause) {
  const confirmed = await withTenant(prisma, actor.tenantId, async (tx) => {
    await assertActor(tx, actor);
    const peek = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: meetingId } } });
    if (!peek) throw new CalendarError('CONFLICT', 409);
    await lockOrganizers(tx, actor.tenantId, [peek.organizerId]);
    await checkpoint(pause, 'during-confirm');
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: meetingId } } });
    if (!meeting || meeting.version !== version || meeting.state !== 'APPROVED_INTERNAL' || !meeting.holdId) throw new CalendarError('CONFLICT', 409);
    const hold = await openHold(tx, actor.tenantId, meeting.holdId);
    await assertFree(tx, actor.tenantId, meeting.organizerId, hold.startAt, hold.endAt, hold.id);
    const updated = await tx.calendarMeeting.updateMany({ where: { tenantId: actor.tenantId, id: meetingId, version, state: 'APPROVED_INTERNAL' }, data: { state: 'BOOKED_INTERNAL', version: { increment: 1 } } });
    if (updated.count !== 1) throw new CalendarError('CONFLICT', 409);
    await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: hold.id, status: 'HELD' }, data: { status: 'CONFIRMED' } });
    await tx.calendarExternalLink.create({ data: { tenantId: actor.tenantId, meetingId, correlationId: randomUUID(), state: 'CLOSED_GATE', providerEventId: null } });
    await tx.calendarActivity.create({ data: { tenantId: actor.tenantId, meetingId, action: 'BOOKED_INTERNAL', actorId: actor.userId, detail: 'CLOSED_GATE' } });
    await audit(tx, actor, 'calendar.meeting.confirm', meetingId, 'BOOKED_INTERNAL');
    return { id: meetingId, state: 'BOOKED_INTERNAL' as const, availabilityMode: 'LOCAL_ONLY' as const, externalState: 'CLOSED_GATE' as const, conferenceUrl: null };
  });
  await checkpoint(pause, 'after-confirm');
  return confirmed;
}

export async function rescheduleMeeting(prisma: PrismaClient, actor: Actor, input: { meetingId: string; version: number; localStart: string }, pause?: CalendarPause) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertActor(tx, actor);
    const peek = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } });
    if (!peek) throw new CalendarError('CONFLICT', 409);
    await lockOrganizers(tx, actor.tenantId, [peek.organizerId]);
    await checkpoint(pause, 'during-reschedule');
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } });
    if (!meeting || meeting.version !== input.version || !['BOOKED_INTERNAL', 'RESCHEDULE_REQUESTED'].includes(meeting.state)) throw new CalendarError('CONFLICT', 409);
    const local = zonedLocalToUtc(input.localStart, meeting.timeZone);
    if ('error' in local) throw new CalendarError(local.error);
    const type = await meetingType(tx, actor.tenantId, meeting.meetingTypeId);
    const end = new Date(local.utc.getTime() + type.durationMinutes * 60_000);
    await assertFree(tx, actor.tenantId, meeting.organizerId, local.utc, end, meeting.holdId ?? undefined, meeting.id);
    if (meeting.holdId) await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: meeting.holdId, status: { in: ['HELD', 'CONFIRMED'] } }, data: { status: 'RELEASED' } });
    const hold = await tx.calendarHold.create({ data: { tenantId: actor.tenantId, organizerId: meeting.organizerId, meetingTypeId: type.id, startAt: local.utc, endAt: end, timeZone: meeting.timeZone, status: 'HELD', expiresAt: new Date(Date.now() + 15 * 60_000), createdBy: actor.userId } });
    const next = type.approvalRequired ? 'PENDING_APPROVAL' : 'BOOKED_INTERNAL';
    if (next === 'BOOKED_INTERNAL') await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: hold.id, status: 'HELD' }, data: { status: 'CONFIRMED' } });
    const updated = await tx.calendarMeeting.updateMany({ where: { tenantId: actor.tenantId, id: meeting.id, version: input.version }, data: { holdId: hold.id, startAt: local.utc, endAt: end, state: next, version: { increment: 1 } } });
    if (updated.count !== 1) throw new CalendarError('CONFLICT', 409);
    await audit(tx, actor, 'calendar.meeting.reschedule', meeting.id, next);
    return { id: meeting.id, state: next, externalWrite: 'NOT_AUTHORIZED' };
  });
}

export async function cancelMeeting(prisma: PrismaClient, actor: Actor, input: { meetingId: string; version: number; reason: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertActor(tx, actor);
    const peek = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } });
    if (!peek) throw new CalendarError('CONFLICT', 409);
    await lockOrganizers(tx, actor.tenantId, [peek.organizerId]);
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } });
    if (!meeting || meeting.version !== input.version || meeting.state === 'CANCELLED_INTERNAL') throw new CalendarError('CONFLICT', 409);
    if (meeting.holdId) await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: meeting.holdId, status: { in: ['HELD', 'CONFIRMED'] } }, data: { status: 'RELEASED' } });
    const updated = await tx.calendarMeeting.updateMany({ where: { tenantId: actor.tenantId, id: meeting.id, version: input.version }, data: { state: 'CANCELLED_INTERNAL', version: { increment: 1 } } });
    if (updated.count !== 1) throw new CalendarError('CONFLICT', 409);
    await tx.calendarActivity.create({ data: { tenantId: actor.tenantId, meetingId: meeting.id, action: 'CANCELLED_INTERNAL', actorId: actor.userId, detail: input.reason.slice(0, 200) } });
    await audit(tx, actor, 'calendar.meeting.cancel', meeting.id, 'CANCELLED_INTERNAL');
    return { id: meeting.id, state: 'CANCELLED_INTERNAL', noticeSent: false };
  });
}

export async function addMeetingNote(prisma: PrismaClient, actor: Actor, input: { meetingId: string; body: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await owned(tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } }), 'NOT_FOUND');
    const note = await tx.calendarNote.create({ data: { tenantId: actor.tenantId, meetingId: input.meetingId, body: input.body.slice(0, 4000), createdBy: actor.userId } });
    await audit(tx, actor, 'calendar.note.create', note.id, 'NOTE');
    return { id: note.id };
  });
}

export async function recordMeetingOutcome(prisma: PrismaClient, actor: Actor, input: { meetingId: string; outcome: string; note: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } });
    if (!meeting || meeting.state !== 'BOOKED_INTERNAL' && meeting.state !== 'COMPLETED') throw new CalendarError('CONFLICT', 409);
    await tx.calendarMeeting.updateMany({ where: { tenantId: actor.tenantId, id: meeting.id }, data: { state: 'COMPLETED' } });
    const row = await tx.calendarOutcome.create({ data: { tenantId: actor.tenantId, meetingId: meeting.id, outcome: input.outcome, note: input.note.slice(0, 1000), createdBy: actor.userId } });
    return { id: row.id, outcome: row.outcome, suggestion: false };
  });
}

export async function addMeetingTask(prisma: PrismaClient, actor: Actor, input: { meetingId: string; title: string; dueOn?: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await owned(tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } }), 'NOT_FOUND');
    const task = await tx.calendarTask.create({ data: { tenantId: actor.tenantId, meetingId: input.meetingId, title: input.title.slice(0, 200), dueOn: input.dueOn ? new Date(`${input.dueOn}T00:00:00.000Z`) : null, assigneeId: actor.userId, createdBy: actor.userId } });
    return { id: task.id, status: task.status, delivered: false };
  });
}

export async function meetingPage(prisma: PrismaClient, actor: Actor, input: { search?: string; state?: string; take: number; skip: number }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const where = { tenantId: actor.tenantId, ...(input.state ? { state: input.state } : {}), ...(input.search ? { title: { contains: input.search.slice(0, 80) } } : {}) };
    const [rows, total] = await Promise.all([
      tx.calendarMeeting.findMany({ where, orderBy: { startAt: 'asc' }, take: input.take, skip: input.skip }),
      tx.calendarMeeting.count({ where }),
    ]);
    return { rows: rows.map(publicMeeting), total };
  });
}

export async function meetingRecord(prisma: PrismaClient, actor: Actor, meetingId: string, includeNotes: boolean) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: meetingId } } });
    if (!meeting) throw new CalendarError('NOT_FOUND', 404);
    const [activity, tasks, outcome, notes, link] = await Promise.all([
      tx.calendarActivity.findMany({ where: { tenantId: actor.tenantId, meetingId }, orderBy: { createdAt: 'asc' }, take: 50 }),
      tx.calendarTask.findMany({ where: { tenantId: actor.tenantId, meetingId }, take: 20 }),
      tx.calendarOutcome.findFirst({ where: { tenantId: actor.tenantId, meetingId }, orderBy: { createdAt: 'desc' } }),
      includeNotes ? tx.calendarNote.findMany({ where: { tenantId: actor.tenantId, meetingId }, take: 20 }) : Promise.resolve([]),
      tx.calendarExternalLink.findFirst({ where: { tenantId: actor.tenantId, meetingId } }),
    ]);
    return { ...publicMeeting(meeting), activity, tasks, outcome, notes, external: link ? { state: link.state, providerEventId: null } : { state: 'NOT_ATTEMPTED', providerEventId: null } };
  });
}

export async function calendarAnalytics(prisma: PrismaClient, actor: Actor) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const rows = await tx.calendarMeeting.groupBy({ by: ['state'], where: { tenantId: actor.tenantId }, _count: { _all: true } });
    const count = (state: string) => rows.find((row) => row.state === state)?._count._all ?? 0;
    return {
      requests: rows.reduce((sum, row) => sum + row._count._all, 0),
      pendingApprovals: count('PENDING_APPROVAL'),
      bookedInternal: count('BOOKED_INTERNAL'),
      cancelled: count('CANCELLED_INTERNAL'),
      completed: count('COMPLETED'),
      externalConfirmations: 'NOT_AVAILABLE',
      invitationDelivery: 'NOT_AVAILABLE',
    };
  });
}

export async function proposeMeeting(prisma: PrismaClient, actor: Actor, input: { organizerId: string; meetingTypeId: string; fromDate: string; throughDate: string; leadId?: string; title: string; text: string }) {
  const intent = classifyMeetingIntent(input.text);
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const slots = await slotsFor(tx, actor.tenantId, input.organizerId, input.meetingTypeId, input.fromDate, input.throughDate, 'LOCAL_ONLY');
    const first = slots[0];
    if (!first) throw new CalendarError('NO_SLOT');
    const type = await meetingType(tx, actor.tenantId, input.meetingTypeId);
    const meeting = await tx.calendarMeeting.create({
      data: {
        tenantId: actor.tenantId, meetingTypeId: type.id, organizerId: input.organizerId, title: input.title, agenda: `Suggested agenda from stored context. Availability is LOCAL_ONLY. ${intent.intent} requires review.`,
        startAt: new Date(first.start), endAt: new Date(first.end), timeZone: type.timeZone, locationType: 'VIRTUAL_PENDING', state: 'DRAFT', availabilityMode: 'LOCAL_ONLY',
        leadId: input.leadId, sourceKind: 'AI_PROPOSAL', createdBy: actor.userId,
      },
    });
    return { id: meeting.id, state: 'DRAFT', review: intent.review, availabilityMode: 'LOCAL_ONLY', conferenceUrl: null, slots: slots.slice(0, 3), intent: intent.intent };
  });
}

export async function executeCalendarTool(tx: Client, tenantId: string, actor: { userId: string; meetingId?: string }, tool: string): Promise<Record<string, unknown>> {
  if (tool === 'calendar.connection.read') {
    const rows = await tx.calendarConnection.findMany({ where: { tenantId }, take: 20 });
    return { connections: rows.map(publicConnection), externalWrite: 'NOT_AUTHORIZED' };
  }
  if (tool === 'calendar.availability.read' || tool === 'calendar.slot.suggest' || tool === 'calendar.slot.validate') {
    const slots = await offeredSlots(tx, tenantId, actor.userId);
    return { slots: slots.slice(0, 3).map((slot) => ({ localStart: slot.localStart, state: slot.state, mode: 'LOCAL_ONLY' as const })), availabilityMode: 'LOCAL_ONLY' as const, review: 'REVIEW_REQUIRED' as const, externalWrite: 'NOT_AUTHORIZED' as const };
  }
  if (tool === 'calendar.crm.context.read') {
    return { account: await latestAccountName(tx, tenantId), review: 'REVIEW_REQUIRED' as const, externalWrite: 'NOT_AUTHORIZED' as const };
  }
  if (tool === 'calendar.meeting.propose' || tool === 'calendar.agenda.propose' || tool === 'calendar.approval.propose') {
    return { review: 'REVIEW_REQUIRED', availabilityMode: 'LOCAL_ONLY', conferenceUrl: null, booked: false, externalWrite: 'NOT_AUTHORIZED' };
  }
  if (tool === 'calendar.booking.status.read' && actor.meetingId) {
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId, id: actor.meetingId } } });
    return { state: meeting?.state ?? 'NOT_FOUND', availabilityMode: meeting?.availabilityMode ?? 'LOCAL_ONLY', externalWrite: 'NOT_AUTHORIZED' };
  }
  return { review: 'REVIEW_REQUIRED', externalWrite: 'NOT_AUTHORIZED' };
}

export async function calendarPromptFacts(tx: Client, tenantId: string, userId: string, meetingId: string, excerpt = ''): Promise<string> {
  const meeting = meetingId ? await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId, id: meetingId } } }) : null;
  const slots = userId ? await offeredSlots(tx, tenantId, userId) : [];
  const accountName = await latestAccountName(tx, tenantId);
  const phrase = requiredAgendaPhrase(excerpt);
  return [
    `MEETING STATE: ${meeting?.state ?? 'NONE'}`,
    'AVAILABILITY: LOCAL_ONLY',
    'EXTERNAL WRITE: NOT_AUTHORIZED',
    'CONFERENCE URL: none',
    `CRM ACCOUNT: ${accountName || 'NONE'}`,
    `REQUIRED AGENDA PHRASE: ${phrase || 'NONE'}`,
    'Copy REQUIRED AGENDA PHRASE into agenda exactly. Copy PREFERRED SLOT into slot exactly. Set availability to LOCAL_ONLY. Include CRM ACCOUNT in summary.',
    `PREFERRED SLOT: ${slots[0]?.localStart ?? 'NONE'}`,
    'STORED SLOTS:',
    slots.slice(0, 3).map((slot) => slot.localStart).join('\n') || 'NONE',
  ].join('\n');
}

export async function persistAgendaProposal(tx: Client, tenantId: string, userId: string, output: unknown, excerpt = ''): Promise<{ persisted: boolean; review: 'REVIEW_REQUIRED'; id?: string }> {
  const slots = await offeredSlots(tx, tenantId, userId);
  const accountName = await latestAccountName(tx, tenantId);
  const phrase = requiredAgendaPhrase(excerpt);
  const decision = acceptMeetingProposal(output, { slots: slots.map((slot) => slot.localStart), agendaPhrase: phrase, accountName });
  if (!decision.accepted || !decision.slot) return { persisted: false, review: 'REVIEW_REQUIRED' };
  const chosen = slots.find((slot) => slot.localStart === decision.slot);
  const type = await tx.calendarMeetingType.findFirst({ where: { tenantId, active: true, archivedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!chosen || !type) return { persisted: false, review: 'REVIEW_REQUIRED' };
  const lead = await tx.crmLead.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  const meeting = await tx.calendarMeeting.create({
    data: {
      tenantId, meetingTypeId: type.id, organizerId: userId, title: type.name, agenda: decision.agenda,
      startAt: new Date(chosen.start), endAt: new Date(chosen.end), timeZone: type.timeZone, locationType: 'VIRTUAL_PENDING',
      state: 'DRAFT', availabilityMode: 'LOCAL_ONLY', leadId: lead?.id ?? null, accountId: lead?.accountId ?? null,
      sourceKind: 'AI_PROPOSAL', createdBy: userId,
    },
  });
  await tx.calendarActivity.create({ data: { tenantId, meetingId: meeting.id, action: 'PROPOSAL_REVIEW', actorId: userId, detail: 'REVIEW_REQUIRED' } });
  return { persisted: true, review: 'REVIEW_REQUIRED', id: meeting.id };
}

export async function reassignMeetingOrganizer(prisma: PrismaClient, actor: Actor, input: { meetingId: string; version: number; organizerId: string }) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertActor(tx, actor);
    const peek = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } });
    if (!peek || peek.version !== input.version || peek.state === 'CANCELLED_INTERNAL') throw new CalendarError('CONFLICT', 409);
    await lockOrganizers(tx, actor.tenantId, [peek.organizerId, input.organizerId]);
    const meeting = await tx.calendarMeeting.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: input.meetingId } } });
    if (!meeting || meeting.version !== input.version || meeting.state === 'CANCELLED_INTERNAL') throw new CalendarError('CONFLICT', 409);
    const type = await meetingType(tx, actor.tenantId, meeting.meetingTypeId);
    await assertHost(tx, actor.tenantId, input.organizerId, type.id);
    await assertFree(tx, actor.tenantId, input.organizerId, meeting.startAt, meeting.endAt);
    if (meeting.holdId) await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: meeting.holdId, status: { in: ['HELD', 'CONFIRMED'] } }, data: { status: 'RELEASED' } });
    const hold = await tx.calendarHold.create({ data: { tenantId: actor.tenantId, organizerId: input.organizerId, meetingTypeId: type.id, startAt: meeting.startAt, endAt: meeting.endAt, timeZone: meeting.timeZone, status: 'HELD', expiresAt: new Date(Date.now() + 15 * 60_000), createdBy: actor.userId } });
    const next = type.approvalRequired ? 'PENDING_APPROVAL' : meeting.state;
    if (next === 'BOOKED_INTERNAL') await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: hold.id, status: 'HELD' }, data: { status: 'CONFIRMED' } });
    const updated = await tx.calendarMeeting.updateMany({ where: { tenantId: actor.tenantId, id: meeting.id, version: input.version }, data: { organizerId: input.organizerId, holdId: hold.id, state: next, version: { increment: 1 } } });
    if (updated.count !== 1) throw new CalendarError('CONFLICT', 409);
    await audit(tx, actor, 'calendar.meeting.reassign', meeting.id, next);
    return { id: meeting.id, organizerId: input.organizerId, state: next, externalWrite: 'NOT_AUTHORIZED' };
  });
}

export async function processCalendarJob(prisma: PrismaClient, actor: Actor, pause?: CalendarPause) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const gate = await gateFor(tx, actor);
    if (gate !== 'ALLOW') throw new CalendarError(gate, 409);
    const due = await tx.calendarHold.findMany({ where: { tenantId: actor.tenantId, status: 'HELD', expiresAt: { lt: new Date() } }, take: 50 });
    await lockOrganizers(tx, actor.tenantId, due.map((hold) => hold.organizerId));
    await checkpoint(pause, 'during-expire');
    let expired = 0;
    for (const hold of due) {
      const updated = await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: hold.id, status: 'HELD', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
      expired += updated.count;
    }
    return { expired, externalWrites: 0 };
  });
}

export async function expireHeldSlot(prisma: PrismaClient, actor: Actor, holdId: string, pause?: CalendarPause) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    await assertActor(tx, actor);
    const peek = await tx.calendarHold.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: holdId } } });
    if (!peek) return { expired: 0, externalWrites: 0 };
    await lockOrganizers(tx, actor.tenantId, [peek.organizerId]);
    await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: holdId, status: 'HELD' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await checkpoint(pause, 'during-expire');
    const expired = await tx.calendarHold.updateMany({ where: { tenantId: actor.tenantId, id: holdId, status: 'HELD', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
    return { expired: expired.count, externalWrites: 0 };
  });
}

async function slotsFor(tx: Client, tenantId: string, organizerId: string, meetingTypeId: string, fromDate: string, throughDate: string, mode: AvailabilityMode) {
  const type = await meetingType(tx, tenantId, meetingTypeId);
  await assertHost(tx, tenantId, organizerId, type.id);
  const rule = await tx.calendarRule.findFirst({ where: { tenantId, organizerId }, orderBy: { createdAt: 'desc' } });
  if (!rule) throw new CalendarError('NO_WORKING_HOURS');
  const blocked = await tx.calendarBlockedDate.findMany({ where: { tenantId, organizerId }, take: 100 });
  const holds = await tx.calendarHold.findMany({ where: { tenantId, organizerId, status: { in: ['HELD', 'CONFIRMED'] }, expiresAt: { gt: new Date() } }, take: 100 });
  const meetings = await tx.calendarMeeting.findMany({ where: { tenantId, organizerId, state: 'BOOKED_INTERNAL' }, take: 100 });
  const busy: BusyWindow[] = [...holds, ...meetings].map((row) => ({ start: row.startAt.toISOString(), end: row.endAt.toISOString(), state: 'BUSY' as const }));
  return suggestSlots({
    zone: rule.timeZone,
    fromDate,
    throughDate,
    durationMinutes: type.durationMinutes,
    incrementMinutes: 30,
    noticeMinutes: rule.noticeMinutes,
    horizonDays: rule.horizonDays,
    bufferBefore: rule.bufferBeforeMinutes,
    bufferAfter: rule.bufferAfterMinutes,
    workingHours: rule.workingHours as WorkingWindow[],
    blockedDates: blocked.map((row) => row.localDate.toISOString().slice(0, 10)),
    busy,
    now: new Date(),
    mode,
  });
}

async function lockOrganizers(tx: Client, tenantId: string, organizerIds: string[]) {
  for (const organizerId of [...new Set(organizerIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${organizerId}`}))`;
  }
}

async function assertActor(tx: Client, actor: Actor) {
  await assertActiveTenant(tx, actor.tenantId);
  const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } } });
  if (!membership || membership.status !== 'ACTIVE') throw new CalendarError('AUTH_REVOKED', 409);
}

async function assertFree(tx: Client, tenantId: string, organizerId: string, start: Date, end: Date, ignoreHoldId?: string, ignoreMeetingId?: string) {
  const holds = await tx.calendarHold.findMany({ where: { tenantId, organizerId, status: { in: ['HELD', 'CONFIRMED'] }, expiresAt: { gt: new Date() }, ...(ignoreHoldId ? { id: { not: ignoreHoldId } } : {}) } });
  const meetings = await tx.calendarMeeting.findMany({ where: { tenantId, organizerId, state: 'BOOKED_INTERNAL', ...(ignoreMeetingId ? { id: { not: ignoreMeetingId } } : {}) } });
  const clash = [...holds, ...meetings].some((row) => start < row.endAt && end > row.startAt);
  if (clash) throw new CalendarError('SLOT_CONFLICT', 409);
}

async function offeredSlots(tx: Client, tenantId: string, userId: string) {
  const type = await tx.calendarMeetingType.findFirst({ where: { tenantId, active: true, archivedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!type) return [];
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  try {
    return await slotsFor(tx, tenantId, userId, type.id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), 'LOCAL_ONLY');
  } catch (error) {
    if (error instanceof CalendarError) return [];
    throw error;
  }
}

async function latestAccountName(tx: Client, tenantId: string) {
  const lead = await tx.crmLead.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  if (!lead) return '';
  const account = await tx.crmAccount.findUnique({ where: { tenantId_id: { tenantId, id: lead.accountId } } });
  return account?.displayName ?? '';
}

async function openHold(tx: Client, tenantId: string, holdId: string) {
  const hold = await tx.calendarHold.findUnique({ where: { tenantId_id: { tenantId, id: holdId } } });
  if (!hold || hold.status !== 'HELD' || hold.expiresAt.getTime() <= Date.now()) throw new CalendarError('HOLD_EXPIRED', 409);
  return hold;
}

async function meetingType(tx: Client, tenantId: string, id: string) {
  const type = await tx.calendarMeetingType.findUnique({ where: { tenantId_id: { tenantId, id } } });
  if (!type || !type.active || type.archivedAt) throw new CalendarError('NOT_FOUND', 404);
  return type;
}

async function assertHost(tx: Client, tenantId: string, userId: string, meetingTypeId?: string) {
  const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!membership || membership.status !== 'ACTIVE') throw new CalendarError('HOST_UNAVAILABLE', 409);
  if (!meetingTypeId) return;
  const hosts = await tx.calendarMeetingTypeHost.count({ where: { tenantId, meetingTypeId } });
  if (hosts === 0) return;
  const allowed = await tx.calendarMeetingTypeHost.findFirst({ where: { tenantId, meetingTypeId, userId } });
  if (!allowed) throw new CalendarError('HOST_UNAVAILABLE', 409);
}

async function assertActiveTenant(tx: Client, tenantId: string) {
  const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.tenant_is_active(${tenantId}::uuid) AS ok`;
  if (rows[0]?.ok !== true) throw new CalendarError('TENANT_SUSPENDED', 409);
}

async function gateFor(tx: Client, actor: Actor) {
  const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT public.tenant_is_active(${actor.tenantId}::uuid) AS ok`;
  if (rows[0]?.ok !== true) return 'TENANT_SUSPENDED';
  const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } } });
  return membership?.status === 'ACTIVE' ? 'ALLOW' : 'AUTH_REVOKED';
}

async function transition(prisma: PrismaClient, actor: Actor, meetingId: string, version: number, from: string, to: string, action: string) {
  return withTenant(prisma, actor.tenantId, async (tx) => {
    const updated = await tx.calendarMeeting.updateMany({ where: { tenantId: actor.tenantId, id: meetingId, version, state: from }, data: { state: to, version: { increment: 1 } } });
    if (updated.count !== 1) throw new CalendarError('CONFLICT', 409);
    await audit(tx, actor, action, meetingId, to);
    return { id: meetingId, state: to };
  });
}

async function owned<T>(query: Promise<T | null>, code: string) {
  if (!(await query)) throw new CalendarError(code, 404);
}

function publicConnection(row: { id: string; provider: string; displayName: string; readiness: string; grantedScopes: string; writeEnabled: boolean; revocationVersion: number }) {
  return { id: row.id, provider: row.provider, displayName: row.displayName, readiness: row.readiness, grantedScopes: row.grantedScopes, writeEnabled: false, revocationVersion: row.revocationVersion, token: null };
}

function publicMeeting(row: { id: string; title: string; state: string; availabilityMode: string; startAt: Date; endAt: Date; timeZone: string; locationType: string; version: number; organizerId: string; leadId: string | null }) {
  return { id: row.id, title: row.title, state: row.state, availabilityMode: row.availabilityMode, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), timeZone: row.timeZone, locationType: row.locationType, version: row.version, organizerId: row.organizerId, leadId: row.leadId, conferenceUrl: null, externallyConfirmed: false };
}

function meetingDigest(row: { version: number; organizerId: string; startAt: Date; endAt: Date; agenda: string }) {
  return createHash('sha256').update(`${row.version}|${row.organizerId}|${row.startAt.toISOString()}|${row.endAt.toISOString()}|${row.agenda}`).digest('hex');
}

function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function audit(tx: Client, actor: Actor, action: string, entityId: string, detail: string) {
  await tx.auditEvent.create({ data: { tenantId: actor.tenantId, actorType: 'user', actorId: actor.userId, action, entityType: 'calendar', entityId, payload: { detail, externalWrite: false } } });
}

async function checkpoint(pause: CalendarPause | undefined, point: CalendarPause) {
  if (pause !== point) return;
  writeSync(1, 'checkpoint\n');
  await new Promise(() => undefined);
}
