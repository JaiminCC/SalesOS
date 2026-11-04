import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { foundationPingModes, type FoundationPingMode } from '@salesos/shared';

export class FoundationPingDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @IsOptional()
  @IsIn(foundationPingModes)
  mode?: FoundationPingMode;
}
