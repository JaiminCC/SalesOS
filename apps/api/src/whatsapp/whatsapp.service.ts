import { Inject, Injectable } from '@nestjs/common';
import { decodeEncryptionKey, WhatsAppError, acceptWhatsAppWebhook, acknowledgeAlert, addPhone, addTemplateVersion, assignConversation, conversationDetail, conversationPage, createConnection, createWhatsAppTemplate, decideDraft, disableConnection, linkConversation, listAlerts, listConnections, listPhones, prepareConversationDraft, processPendingWhatsApp, rotateCredential, updateConnection, whatsappOverview, withTenant } from '@salesos/database';
import { graphApiVersion, metaAppReadiness, verifyHandshake } from '@salesos/shared';
import { ApiException } from '../common/api.exception';
import { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import type { SessionContext } from '../identity/identity.service';
import type { AssignDto, ConnectionBodyDto, ConnectionChangeDto, DraftDecisionDto, LinkDto, PhoneBodyDto, TemplateBodyDto, TemplateVersionDto, WhatsAppPageDto } from './whatsapp.dto';

@Injectable()
export class WhatsAppService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  overview(actor: SessionContext) {
    return this.run(() => whatsappOverview(this.database.prisma, this.tenant(actor)).then((row) => ({
      ...row,
      appReadiness: metaAppReadiness(this.config.env),
      graphVersion: safeVersion(this.config.env),
      embeddedSignup: this.config.env.META_EMBEDDED_SIGNUP_CONFIG_ID ? 'AUTHORIZATION_REQUIRED' : 'NOT_CONFIGURED',
      outbound: 'NOT_AUTHORIZED',
    })));
  }

  connections(actor: SessionContext, query: WhatsAppPageDto) {
    return this.run(() => listConnections(this.database.prisma, this.tenant(actor), query.page, query.pageSize, query.query));
  }

  createConnection(actor: SessionContext, input: ConnectionBodyDto) {
    return this.run(() => createConnection(this.database.prisma, this.actor(actor), input));
  }

  updateConnection(actor: SessionContext, id: string, input: ConnectionChangeDto) {
    return this.run(() => updateConnection(this.database.prisma, this.actor(actor), id, input));
  }

  disable(actor: SessionContext, id: string) {
    return this.run(() => disableConnection(this.database.prisma, this.actor(actor), id));
  }

  rotate(actor: SessionContext, id: string, token: string) {
    return this.run(() => rotateCredential(this.database.prisma, this.actor(actor), id, token, decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY)));
  }

  phones(actor: SessionContext, query: WhatsAppPageDto) {
    return this.run(() => listPhones(this.database.prisma, this.tenant(actor), query.page, query.pageSize));
  }

  addPhone(actor: SessionContext, input: PhoneBodyDto) {
    return this.run(() => addPhone(this.database.prisma, this.actor(actor), input));
  }

  conversations(actor: SessionContext, query: WhatsAppPageDto) {
    return this.run(() => conversationPage(this.database.prisma, this.tenant(actor), query));
  }

  conversation(actor: SessionContext, id: string) {
    return this.run(() => conversationDetail(this.database.prisma, this.tenant(actor), id, actor.permissions.includes('whatsapp.messages.read')));
  }

  assign(actor: SessionContext, id: string, input: AssignDto) {
    return this.run(() => assignConversation(this.database.prisma, this.actor(actor), id, input));
  }

  link(actor: SessionContext, id: string, input: LinkDto) {
    return this.run(() => linkConversation(this.database.prisma, this.actor(actor), id, input));
  }

  prepare(actor: SessionContext, id: string) {
    return this.run(() => prepareConversationDraft(this.database.prisma, this.actor(actor), id));
  }

  decide(actor: SessionContext, input: DraftDecisionDto) {
    return this.run(() => decideDraft(this.database.prisma, this.actor(actor), input));
  }

  templates(actor: SessionContext, query: WhatsAppPageDto) {
    return this.run(() => withTenant(this.database.prisma, this.tenant(actor), async (tx) => {
      const rows = await tx.whatsappTemplate.findMany({ where: { tenantId: this.tenant(actor), archivedAt: null }, orderBy: { createdAt: 'desc' }, skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20), take: query.pageSize ?? 20 });
      const versions = await tx.whatsappTemplateVersion.findMany({ where: { tenantId: this.tenant(actor), templateId: { in: rows.map((row) => row.id) } }, orderBy: { versionNumber: 'desc' } });
      return { rows: rows.map((row) => ({ ...row, providerStatus: versions.find((version) => version.templateId === row.id)?.providerStatus ?? 'PROVIDER_UNKNOWN', metaApproved: false })), total: rows.length };
    }));
  }

  createTemplate(actor: SessionContext, input: TemplateBodyDto) {
    return this.run(() => createWhatsAppTemplate(this.database.prisma, this.actor(actor), input));
  }

  addVersion(actor: SessionContext, input: TemplateVersionDto) {
    return this.run(() => addTemplateVersion(this.database.prisma, this.actor(actor), input.id, input.body));
  }

  alerts(actor: SessionContext) {
    return this.run(() => listAlerts(this.database.prisma, this.tenant(actor)));
  }

  acknowledge(actor: SessionContext, id: string) {
    return this.run(() => acknowledgeAlert(this.database.prisma, this.actor(actor), id));
  }

  processPending(actor: SessionContext) {
    return this.run(() => processPendingWhatsApp(this.database.prisma, this.actor(actor), decodeEncryptionKey(this.config.env.DATA_ENCRYPTION_KEY)));
  }

  events(actor: SessionContext) {
    return this.run(() => withTenant(this.database.prisma, this.tenant(actor), (tx) => tx.whatsappProviderError.findMany({ where: { tenantId: this.tenant(actor) }, orderBy: { createdAt: 'desc' }, take: 50 })));
  }

  handshake(query: { mode?: string; token?: string; challenge?: string }) {
    return verifyHandshake(query, this.config.env.META_WEBHOOK_VERIFY_TOKEN);
  }

  receive(raw: Buffer, signature: string | undefined, contentType: string | undefined) {
    if (!contentType?.toLowerCase().startsWith('application/json')) throw new ApiException(415, 'UNSUPPORTED_MEDIA', 'Webhook content type was rejected');
    const secret = this.config.env.META_APP_SECRET ?? '';
    if (!secret) throw new ApiException(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook verification is not configured');
    return this.run(() => acceptWhatsAppWebhook(this.database.prisma, { secret, raw, signature, origin: 'STUB_TESTED' }));
  }

  private actor(actor: SessionContext) {
    return { tenantId: this.tenant(actor), userId: actor.userId };
  }

  private tenant(actor: SessionContext) {
    if (!actor.tenantId) throw new ApiException(409, 'ORGANIZATION_REQUIRED', 'Choose an organization first');
    return actor.tenantId;
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof WhatsAppError) throw new ApiException(error.status, error.code, error.message);
      throw error;
    }
  }
}

function safeVersion(env: { META_GRAPH_API_VERSION?: string }): string {
  try {
    return graphApiVersion(env);
  } catch {
    return 'UNSAFE_API_VERSION';
  }
}
