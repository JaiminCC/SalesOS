import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class WhatsAppPageDto {
  @IsOptional() @IsInt() @Min(1) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(120) query?: string;
  @IsOptional() @IsString() @MaxLength(40) state?: string;
  @IsOptional() @IsBoolean() unread?: boolean;
}

export class WhatsAppIdDto {
  @IsUUID() id!: string;
}

export class ConnectionBodyDto {
  @IsString() @MinLength(2) @MaxLength(120) displayName!: string;
  @IsString() @MinLength(6) @MaxLength(20) wabaId!: string;
  @IsOptional() @IsIn(['MANUAL', 'EMBEDDED']) mode?: 'MANUAL' | 'EMBEDDED';
}

export class ConnectionChangeDto extends WhatsAppIdDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
}

export class CredentialDto extends WhatsAppIdDto {
  @IsString() @MinLength(8) @MaxLength(4000) token!: string;
}

export class PhoneBodyDto {
  @IsUUID() connectionId!: string;
  @IsString() @MinLength(6) @MaxLength(20) providerPhoneId!: string;
  @IsString() @MinLength(8) @MaxLength(20) displayNumber!: string;
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
}

export class AssignDto extends WhatsAppIdDto {
  @IsIn(['ASSIGN', 'TAKE_OVER', 'RELEASE', 'RESOLVE', 'REOPEN']) action!: 'ASSIGN' | 'TAKE_OVER' | 'RELEASE' | 'RESOLVE' | 'REOPEN';
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class LinkDto extends WhatsAppIdDto {
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() leadId?: string;
}

export class DraftPrepareDto extends WhatsAppIdDto {}

export class DraftDecisionDto {
  @IsUUID() draftId!: string;
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsString() @MinLength(64) @MaxLength(64) digest!: string;
}

export class TemplateBodyDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(2) @MaxLength(12) language!: string;
  @IsIn(['MARKETING', 'UTILITY', 'AUTHENTICATION']) category!: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class TemplateVersionDto extends WhatsAppIdDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}
