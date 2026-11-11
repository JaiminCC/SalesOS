import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { apiSuccess } from '@salesos/shared';
import { PermissionGuard, SessionGuard, type AuthenticatedRequest } from '../identity/auth.guard';
import { RequirePermissions } from '../identity/require-permissions';
import { AvailabilityDto, BlockedDateDto, CalendarPageDto, ConnectionCreateDto, ConnectionIdDto, HoldDto, MeetingCreateDto, MeetingIdDto, MeetingTypeDto, MeetingVersionDto, NoteDto, OutcomeDto, ProposalDto, RuleDto, TaskDto } from './calendar.dto';
import { CalendarService } from './calendar.service';

@Controller('management/calendar')
@UseGuards(SessionGuard, PermissionGuard)
export class CalendarController {
  constructor(@Inject(CalendarService) private readonly calendar: CalendarService) {}

  @Post('overview') @HttpCode(200) @RequirePermissions('calendar.meetings.read')
  overview(@Req() request: AuthenticatedRequest) { return this.ok(this.calendar.overview(request.auth!), request.requestId); }

  @Post('connections/list') @HttpCode(200) @RequirePermissions('calendar.connections.read')
  connections(@Req() request: AuthenticatedRequest) { return this.ok(this.calendar.connections(request.auth!), request.requestId); }

  @Post('connections/create') @HttpCode(200) @RequirePermissions('calendar.connections.manage')
  createConnection(@Body() body: ConnectionCreateDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.createConnection(request.auth!, body), request.requestId); }

  @Post('connections/oauth/start') @HttpCode(200) @RequirePermissions('calendar.connections.manage')
  start(@Body() body: ConnectionIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.startOauth(request.auth!, body), request.requestId); }

  @Post('connections/oauth/callback') @HttpCode(200) @RequirePermissions('calendar.connections.manage')
  callback(@Body() body: ConnectionIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.callback(request.auth!, body), request.requestId); }

  @Post('connections/disconnect') @HttpCode(200) @RequirePermissions('calendar.connections.manage')
  disconnect(@Body() body: ConnectionIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.disconnect(request.auth!, body), request.requestId); }

  @Post('rules/save') @HttpCode(200) @RequirePermissions('calendar.availability.manage')
  rule(@Body() body: RuleDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.saveRule(request.auth!, body), request.requestId); }

  @Post('rules/block') @HttpCode(200) @RequirePermissions('calendar.availability.manage')
  block(@Body() body: BlockedDateDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.blockDate(request.auth!, body), request.requestId); }

  @Post('meeting-types/list') @HttpCode(200) @RequirePermissions('calendar.meeting_types.read')
  types(@Req() request: AuthenticatedRequest) { return this.ok(this.calendar.types(request.auth!), request.requestId); }

  @Post('meeting-types/create') @HttpCode(200) @RequirePermissions('calendar.meeting_types.manage')
  createType(@Body() body: MeetingTypeDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.createType(request.auth!, body), request.requestId); }

  @Post('availability') @HttpCode(200) @RequirePermissions('calendar.availability.read')
  availability(@Body() body: AvailabilityDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.availability(request.auth!, body), request.requestId); }

  @Post('slot-holds/create') @HttpCode(200) @RequirePermissions('calendar.bookings.create')
  hold(@Body() body: HoldDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.hold(request.auth!, body), request.requestId); }

  @Post('booking-requests/create') @HttpCode(200) @RequirePermissions('calendar.bookings.create')
  request(@Body() body: MeetingCreateDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.createMeeting(request.auth!, body), request.requestId); }

  @Post('meetings/list') @HttpCode(200) @RequirePermissions('calendar.meetings.read')
  meetings(@Body() body: CalendarPageDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.meetings(request.auth!, body), request.requestId); }

  @Post('meetings/get') @HttpCode(200) @RequirePermissions('calendar.meetings.read')
  meeting(@Body() body: MeetingIdDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.meeting(request.auth!, body), request.requestId); }

  @Post('meetings/submit') @HttpCode(200) @RequirePermissions('calendar.bookings.create')
  submit(@Body() body: MeetingVersionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.submit(request.auth!, body), request.requestId); }

  @Post('approvals/decide') @HttpCode(200) @RequirePermissions('calendar.bookings.review')
  approve(@Body() body: MeetingVersionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.approve(request.auth!, body), request.requestId); }

  @Post('meetings/confirm') @HttpCode(200) @RequirePermissions('calendar.bookings.manage')
  confirm(@Body() body: MeetingVersionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.confirm(request.auth!, body), request.requestId); }

  @Post('meetings/reschedule') @HttpCode(200) @RequirePermissions('calendar.bookings.manage')
  reschedule(@Body() body: MeetingVersionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.reschedule(request.auth!, body), request.requestId); }

  @Post('meetings/cancel') @HttpCode(200) @RequirePermissions('calendar.bookings.manage')
  cancel(@Body() body: MeetingVersionDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.cancel(request.auth!, body), request.requestId); }

  @Post('notes/create') @HttpCode(200) @RequirePermissions('calendar.notes.manage')
  note(@Body() body: NoteDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.note(request.auth!, body), request.requestId); }

  @Post('outcomes/record') @HttpCode(200) @RequirePermissions('calendar.meetings.manage')
  outcome(@Body() body: OutcomeDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.outcome(request.auth!, body), request.requestId); }

  @Post('tasks/create') @HttpCode(200) @RequirePermissions('calendar.meetings.manage')
  task(@Body() body: TaskDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.task(request.auth!, body), request.requestId); }

  @Post('proposals/create') @HttpCode(200) @RequirePermissions('calendar.bookings.create')
  proposal(@Body() body: ProposalDto, @Req() request: AuthenticatedRequest) { return this.ok(this.calendar.proposal(request.auth!, body), request.requestId); }

  @Post('analytics') @HttpCode(200) @RequirePermissions('calendar.analytics.read')
  analytics(@Req() request: AuthenticatedRequest) { return this.ok(this.calendar.analytics(request.auth!), request.requestId); }

  @Post('operations') @HttpCode(200) @RequirePermissions('calendar.operations.read')
  operations(@Req() request: AuthenticatedRequest) { return this.ok(this.calendar.overview(request.auth!), request.requestId); }

  private ok<T>(value: Promise<T>, requestId: string) {
    return value.then((data) => apiSuccess(data, requestId));
  }
}
