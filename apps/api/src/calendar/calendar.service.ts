import { Inject, Injectable } from '@nestjs/common';
import {
  CalendarError,
  addMeetingNote,
  addMeetingTask,
  approveMeeting,
  blockCalendarDate,
  calendarAnalytics,
  calendarAvailability,
  calendarOverview,
  cancelMeeting,
  confirmMeeting,
  consumeCalendarOauth,
  createCalendarConnection,
  createInternalMeeting,
  createMeetingType,
  decodeEncryptionKey,
  disconnectCalendar,
  holdSlot,
  listCalendarConnections,
  listMeetingTypes,
  meetingPage,
  meetingRecord,
  proposeMeeting,
  recordMeetingOutcome,
  rescheduleMeeting,
  saveCalendarRule,
  startCalendarOauth,
  submitMeeting,
} from '@salesos/database';
import { ApiException } from '../common/api.exception';
import { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import type { SessionContext } from '../identity/identity.service';
import type { AvailabilityDto, BlockedDateDto, ConnectionCreateDto, ConnectionIdDto, HoldDto, MeetingCreateDto, MeetingIdDto, MeetingTypeDto, MeetingVersionDto, NoteDto, OutcomeDto, ProposalDto, RuleDto, TaskDto, CalendarPageDto } from './calendar.dto';

@Injectable()
export class CalendarService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  overview(actor: SessionContext) {
    return this.run(() => calendarOverview(this.database.prisma, this.actor(actor), this.config.env));
  }

  connections(actor: SessionContext) {
    return this.run(() => listCalendarConnections(this.database.prisma, this.actor(actor)));
  }

  createConnection(actor: SessionContext, input: ConnectionCreateDto) {
    return this.run(() => createCalendarConnection(this.database.prisma, this.actor(actor), input, this.config.env));
  }

  startOauth(actor: SessionContext, input: ConnectionIdDto) {
    return this.run(() => startCalendarOauth(this.database.prisma, this.actor(actor), { connectionId: input.connectionId, redirectUri: input.redirectUri || `${this.config.env.WEB_ORIGIN}/workspace/meetings` }, this.config.env, decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY)));
  }

  callback(actor: SessionContext, input: ConnectionIdDto) {
    if (!input.state || !input.redirectUri) throw new ApiException(422, 'VALIDATION_ERROR', 'OAuth state was rejected');
    return this.run(() => consumeCalendarOauth(this.database.prisma, this.actor(actor), { state: input.state!, redirectUri: input.redirectUri! }));
  }

  disconnect(actor: SessionContext, input: ConnectionIdDto) {
    return this.run(() => disconnectCalendar(this.database.prisma, this.actor(actor), input.connectionId));
  }

  saveRule(actor: SessionContext, input: RuleDto) {
    return this.run(() => saveCalendarRule(this.database.prisma, this.actor(actor), { ...input, organizerId: actor.userId }));
  }

  blockDate(actor: SessionContext, input: BlockedDateDto) {
    return this.run(() => blockCalendarDate(this.database.prisma, this.actor(actor), { organizerId: actor.userId, localDate: input.localDate, reason: input.reason ?? '' }));
  }

  createType(actor: SessionContext, input: MeetingTypeDto) {
    return this.run(() => createMeetingType(this.database.prisma, this.actor(actor), { ...input, description: input.description ?? '', hostIds: [actor.userId] }));
  }

  types(actor: SessionContext) {
    return this.run(() => listMeetingTypes(this.database.prisma, this.actor(actor)));
  }

  availability(actor: SessionContext, input: AvailabilityDto) {
    return this.run(() => calendarAvailability(this.database.prisma, this.actor(actor), { ...input, organizerId: actor.userId }));
  }

  hold(actor: SessionContext, input: HoldDto) {
    return this.run(() => holdSlot(this.database.prisma, this.actor(actor), { ...input, organizerId: actor.userId }));
  }

  createMeeting(actor: SessionContext, input: MeetingCreateDto) {
    return this.run(() => createInternalMeeting(this.database.prisma, this.actor(actor), { ...input, agenda: input.agenda ?? '' }));
  }

  meetings(actor: SessionContext, input: CalendarPageDto) {
    return this.run(() => meetingPage(this.database.prisma, this.actor(actor), input));
  }

  meeting(actor: SessionContext, input: MeetingIdDto) {
    return this.run(() => meetingRecord(this.database.prisma, this.actor(actor), input.id, actor.permissions.includes('calendar.notes.manage')));
  }

  submit(actor: SessionContext, input: MeetingVersionDto) {
    return this.run(() => submitMeeting(this.database.prisma, this.actor(actor), input.meetingId, input.version));
  }

  approve(actor: SessionContext, input: MeetingVersionDto) {
    return this.run(() => approveMeeting(this.database.prisma, this.actor(actor), input.meetingId, input.version));
  }

  confirm(actor: SessionContext, input: MeetingVersionDto) {
    return this.run(() => confirmMeeting(this.database.prisma, this.actor(actor), input.meetingId, input.version));
  }

  reschedule(actor: SessionContext, input: MeetingVersionDto) {
    if (!input.localStart) throw new ApiException(422, 'VALIDATION_ERROR', 'A new local time is required');
    return this.run(() => rescheduleMeeting(this.database.prisma, this.actor(actor), { meetingId: input.meetingId, version: input.version, localStart: input.localStart! }));
  }

  cancel(actor: SessionContext, input: MeetingVersionDto) {
    return this.run(() => cancelMeeting(this.database.prisma, this.actor(actor), { meetingId: input.meetingId, version: input.version, reason: input.reason ?? '' }));
  }

  note(actor: SessionContext, input: NoteDto) {
    return this.run(() => addMeetingNote(this.database.prisma, this.actor(actor), input));
  }

  outcome(actor: SessionContext, input: OutcomeDto) {
    return this.run(() => recordMeetingOutcome(this.database.prisma, this.actor(actor), { ...input, note: input.note ?? '' }));
  }

  task(actor: SessionContext, input: TaskDto) {
    return this.run(() => addMeetingTask(this.database.prisma, this.actor(actor), input));
  }

  proposal(actor: SessionContext, input: ProposalDto) {
    return this.run(() => proposeMeeting(this.database.prisma, this.actor(actor), { ...input, organizerId: actor.userId }));
  }

  analytics(actor: SessionContext) {
    return this.run(() => calendarAnalytics(this.database.prisma, this.actor(actor)));
  }

  private actor(actor: SessionContext) {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return { tenantId: actor.tenantId, userId: actor.userId };
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CalendarError) throw new ApiException(error.status, error.code, error.message);
      throw error;
    }
  }
}
