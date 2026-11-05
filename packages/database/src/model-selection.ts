import { decryptField } from './crypto';
import { withTenant } from './with-tenant';
import type { PrismaClient } from '@prisma/client';

export type StoredModelSelection = {
  provider: 'fake' | 'openai_compatible' | 'ollama';
  model: string;
  baseUrl: string | null;
  apiKey?: string;
  timeoutMs: number;
  maxOutputTokens: number;
  allowPrivateHttp: boolean;
  inputPerMillion: number;
  outputPerMillion: number;
};

export async function readModelSelection(prisma: PrismaClient, tenantId: string, configurationId: string, key: Buffer, allowPrivate: boolean): Promise<StoredModelSelection> {
  const row = await withTenant(prisma, tenantId, (tx) => tx.modelConfiguration.findUnique({ where: { tenantId_id: { tenantId, id: configurationId } } }));
  if (!row || !row.enabled) throw Object.assign(new Error('The selected model is disabled'), { status: 422 });
  if (row.provider !== 'fake' && row.provider !== 'openai_compatible' && row.provider !== 'ollama') {
    throw Object.assign(new Error('The selected model provider is not supported'), { status: 422 });
  }
  const apiKey = row.credentialCiphertext ? decryptField(Buffer.from(row.credentialCiphertext), key) : undefined;
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    apiKey,
    timeoutMs: row.timeoutMs,
    maxOutputTokens: row.maxOutputTokens,
    allowPrivateHttp: Boolean(row.allowPrivateHttp && allowPrivate),
    inputPerMillion: row.inputPriceMinorPerMillion,
    outputPerMillion: row.outputPriceMinorPerMillion,
  };
}
