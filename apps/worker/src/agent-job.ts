import type { Job } from 'bullmq';
import { createModelClient } from '@salesos/agent-core';
import { advanceAgentRun, decodeEncryptionKey, readModelSelection, withTenant, type PrismaClient } from '@salesos/database';
import type { AgentRunJobData } from '@salesos/shared';

export async function processAgentRunJob(job: Job<AgentRunJobData>, prisma: PrismaClient, encryptionKey: string): Promise<{ state: string }> {
  const { tenantId, runId, outboxId } = job.data;
  const run = await withTenant(prisma, tenantId, (tx) => tx.agentRun.findUnique({ where: { tenantId_id: { tenantId, id: runId } } }));
  if (!run?.modelConfigurationId) return { state: run?.state || 'FAILED_FINAL' };
  const selection = await readModelSelection(prisma, tenantId, run.modelConfigurationId, decodeEncryptionKey(encryptionKey), process.env.NODE_ENV !== 'production');
  const client = await createModelClient(selection);
  return advanceAgentRun(prisma, tenantId, runId, {
    outboxId,
    complete: async (input) => {
      const generated = await client.generateStructured<Record<string, unknown>>({
        tenantId,
        task: input.task,
        promptVersion: 'mvp-1',
        messages: input.messages,
        outputSchema: {
          type: 'object',
          required: ['summary', 'strategy', 'draft'],
          properties: {
            summary: { type: 'string' },
            strategy: { type: 'string' },
            draft: { type: 'string' },
            citations: { type: 'array', items: { type: 'string' } },
          },
        },
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
      });
      return {
        result: generated.result,
        provider: selection.provider,
        model: generated.model,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        traceId: generated.traceId,
        durationMs: generated.latencyMs,
        usageExact: Boolean(generated.usageExact),
        inputPerMillion: selection.inputPerMillion,
        outputPerMillion: selection.outputPerMillion,
      };
    },
  });
}
