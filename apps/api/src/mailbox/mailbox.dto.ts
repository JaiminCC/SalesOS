import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class MailboxListDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsInt() @Min(1) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsIn(['createdAt', 'subject', 'lastActivityAt', 'address']) sortBy?: 'createdAt' | 'subject' | 'lastActivityAt' | 'address';
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
  @IsOptional() @IsUUID() connectionId?: string;
  @IsOptional() @IsString() @MaxLength(40) folder?: string;
}

export class CaptureMailboxDto {
  @IsString() @MaxLength(320) address!: string;
}

export class OauthStartDto {
  @IsIn(['google', 'microsoft']) provider!: 'google' | 'microsoft';
  @IsString() @MaxLength(500) redirectUri!: string;
  @IsOptional() @IsUUID() connectionId?: string;
}

export class SendPolicyDto {
  @IsBoolean() enabled!: boolean;
  @IsBoolean() killSwitch!: boolean;
}

export class MailboxSendingDto {
  @IsUUID() id!: string;
  @IsBoolean() sendingEnabled!: boolean;
}

export class ImportMessagesDto {
  @IsUUID() connectionId!: string;
  @IsArray() messages!: Array<{
    providerMessageId: string;
    providerThreadId?: string;
    internetMessageId?: string;
    inReplyTo?: string;
    references?: string[];
    sender: string;
    recipients?: string[];
    subject?: string;
    text?: string;
    html?: string;
    provenance: string;
  }>;
}

export class ThreadLinkDto {
  @IsUUID() id!: string;
  @IsIn(['contact', 'account', 'lead']) subjectType!: 'contact' | 'account' | 'lead';
  @IsUUID() subjectId!: string;
}

export class ThreadAssignDto {
  @IsUUID() id!: string;
  @IsUUID() ownerUserId!: string;
}

export class ThreadUnlinkDto {
  @IsUUID() id!: string;
  @IsUUID() linkId!: string;
}

export class DraftBodyDto {
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() connectionId!: string;
  @IsOptional() @IsUUID() threadId?: string;
  @IsString() @MaxLength(300) subject!: string;
  @IsString() @MaxLength(20000) body!: string;
  @IsArray() @IsString({ each: true }) recipients!: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) cc?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) bcc?: string[];
}

export class DraftDecisionDto {
  @IsUUID() id!: string;
  @IsIn(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']) decision!: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
}

export class IdDto {
  @IsUUID() id!: string;
}

export class SyncPauseDto {
  @IsUUID() id!: string;
  @IsBoolean() paused!: boolean;
}

export class InvestigationDto {
  @IsUUID() id!: string;
  @IsString() @MaxLength(500) note!: string;
}

export class AnalyzeDto {
  @IsUUID() threadId!: string;
  @IsUUID() productId!: string;
  @IsUUID() modelConfigurationId!: string;
}
