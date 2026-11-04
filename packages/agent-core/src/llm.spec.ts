import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from './llm';

describe('FakeLlmProvider', () => {
  it('returns schema-valid JSON and usage', async () => {
    const provider = new FakeLlmProvider();
    const output = await provider.generateStructured({
      tenantId: '11111111-1111-4111-8111-111111111111',
      task: 'foundation.ping',
      promptVersion: 'v0',
      messages: [{ role: 'user', content: 'ping' }],
      outputSchema: {
        type: 'object',
        required: ['ok', 'task'],
        additionalProperties: false,
      },
      timeoutMs: 1000,
      maxTokens: 50,
    });
    expect(output.result).toEqual({ ok: true, task: 'foundation.ping' });
    expect(output.usage.inputTokens).toBe(1);
    expect(output.usage.outputTokens).toBe(1);
    expect(output.model).toBe('fake-1');
    expect(output.traceId).toContain('11111111');
  });
});
