import { describe, expect, it } from 'vitest';
import { FakeLlmProvider, LlmSchemaError, acceptProposal, generateWithRepair } from './llm';

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  task: 'agent.propose',
  promptVersion: 'mvp-1',
  messages: [{ role: 'user' as const, content: 'SCAN' }],
  outputSchema: { type: 'object' as const, required: ['actionType'] },
  timeoutMs: 1000,
  maxTokens: 200,
};

describe('generateWithRepair', () => {
  it('repairs one invalid payload and escalates on the second', async () => {
    const repaired = await generateWithRepair(new FakeLlmProvider([{ ok: true }, { actionType: 'CREATE_TASK', external: false, summary: 'task' }]), input, acceptProposal);
    expect(repaired.result.actionType).toBe('CREATE_TASK');
    await expect(generateWithRepair(new FakeLlmProvider([{ ok: true }, { ok: false }]), input, acceptProposal)).rejects.toBeInstanceOf(LlmSchemaError);
  });
});
