import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const NAVIGATION_TYPES = [
  'member',
  'organization',
  'product',
  'product_version',
  'icp',
  'knowledge_document',
  'invitation',
  'session',
  'role',
  'product_defaults',
] as const;

export class CreateNavigationDto {
  @IsIn(NAVIGATION_TYPES)
  resourceType!: (typeof NAVIGATION_TYPES)[number];

  @IsIn(['view', 'edit', 'add'])
  action!: 'view' | 'edit' | 'add';

  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  resourceKey?: string;

  @IsIn(['active'])
  organizationContext!: 'active';
}

export class ResolveNavigationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}
