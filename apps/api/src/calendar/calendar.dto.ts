import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CalendarPageDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsString() @MaxLength(40) state?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 20;
  @Type(() => Number) @IsInt() @Min(0) skip = 0;
}

export class ConnectionCreateDto {
  @IsIn(['GOOGLE_CALENDAR', 'MICROSOFT_CALENDAR']) provider!: 'GOOGLE_CALENDAR' | 'MICROSOFT_CALENDAR';
  @IsString() @MinLength(2) @MaxLength(120) displayName!: string;
}

export class ConnectionIdDto {
  @IsUUID() connectionId!: string;
  @IsOptional() @IsString() @MaxLength(300) redirectUri?: string;
  @IsOptional() @IsString() @MaxLength(200) state?: string;
}

export class RuleDto {
  @IsString() @MaxLength(80) timeZone!: string;
  @IsArray() workingHours!: Array<{ weekday: number; startMinute: number; endMinute: number }>;
  @Type(() => Number) @IsInt() @Min(0) @Max(240) bufferBeforeMinutes = 0;
  @Type(() => Number) @IsInt() @Min(0) @Max(240) bufferAfterMinutes = 0;
  @Type(() => Number) @IsInt() @Min(0) @Max(10080) noticeMinutes = 60;
  @Type(() => Number) @IsInt() @Min(1) @Max(60) horizonDays = 14;
}

export class BlockedDateDto {
  @IsString() @MaxLength(10) localDate!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class MeetingTypeDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @Type(() => Number) @IsInt() @IsIn([15, 30, 45, 60, 90]) durationMinutes!: number;
  @IsIn(['VIRTUAL_PENDING', 'PHONE_CALL', 'PHYSICAL', 'OTHER']) locationType!: string;
  @IsString() @MaxLength(80) timeZone!: string;
  @IsBoolean() approvalRequired = true;
}

export class AvailabilityDto {
  @IsUUID() meetingTypeId!: string;
  @IsString() @MaxLength(10) fromDate!: string;
  @IsString() @MaxLength(10) throughDate!: string;
  @IsIn(['LOCAL_ONLY', 'PROVIDER_VALIDATED']) mode: 'LOCAL_ONLY' | 'PROVIDER_VALIDATED' = 'LOCAL_ONLY';
}

export class HoldDto {
  @IsUUID() meetingTypeId!: string;
  @IsString() @MaxLength(16) localStart!: string;
  @IsString() @MaxLength(80) timeZone!: string;
}

export class MeetingCreateDto {
  @IsUUID() holdId!: string;
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) agenda?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() accountId?: string;
}

export class MeetingVersionDto {
  @IsUUID() meetingId!: string;
  @Type(() => Number) @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(16) localStart?: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class NoteDto {
  @IsUUID() meetingId!: string;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class OutcomeDto {
  @IsUUID() meetingId!: string;
  @IsIn(['HELD', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED', 'FOLLOW_UP_REQUIRED', 'QUALIFIED', 'NOT_QUALIFIED', 'UNKNOWN']) outcome!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class TaskDto {
  @IsUUID() meetingId!: string;
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(10) dueOn?: string;
}

export class ProposalDto {
  @IsUUID() meetingTypeId!: string;
  @IsString() @MaxLength(10) fromDate!: string;
  @IsString() @MaxLength(10) throughDate!: string;
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsString() @MaxLength(2000) text!: string;
  @IsOptional() @IsUUID() leadId?: string;
}

export class MeetingIdDto {
  @IsUUID() id!: string;
}
