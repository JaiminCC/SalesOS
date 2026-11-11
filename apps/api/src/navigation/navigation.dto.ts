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
  'agent',
  'agent_run',
  'automation_policy',
  'model_configuration',
  'agent_approval',
  'crm_account',
  'crm_contact',
  'crm_lead',
  'crm_import',
  'crm_discovery',
  'crm_suppression',
  'crm_duplicate',
  'crm_policy',
  'mailbox_connection',
  'mailbox_thread',
  'mailbox_draft',
  'campaign',
  'audience_segment',
  'campaign_sequence',
  'campaign_template',
  'campaign_run',
  'whatsapp_connection',
  'whatsapp_conversation',
  'whatsapp_template',
  'whatsapp_draft',
  'calendar_connection',
  'calendar_meeting',
  'calendar_meeting_type',
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
