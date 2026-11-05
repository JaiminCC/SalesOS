import { LEAD_EXPLANATION_SCHEMA, acceptLeadExplanation, officialFromPrompt, type OfficialBreakdown } from '@salesos/shared';

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type JsonSchema = {
  type: 'object';
  required?: string[];
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
};

export type LlmGenerateInput = {
  tenantId: string;
  task: string;
  promptVersion: string;
  messages: LlmMessage[];
  outputSchema: JsonSchema;
  timeoutMs: number;
  maxTokens: number;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LlmResult<T> = {
  result: T;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
  traceId: string;
  usageExact?: boolean;
};

export interface LlmProvider {
  readonly id: string;
  generateStructured<T>(input: LlmGenerateInput): Promise<LlmResult<T>>;
}

export class LlmSchemaError extends Error {
  constructor() {
    super('The model returned a payload that does not match the schema');
  }
}

export class LlmProviderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function acceptProposal(value: unknown): { actionType: string; external: boolean; summary: string; commercialCommitment: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const actionType = typeof row.actionType === 'string' ? row.actionType : '';
  const allowed = ['RESEARCH_ACCOUNT', 'DRAFT_MESSAGE', 'QUALIFY_REPLY', 'PROPOSE_MEETING', 'SUMMARIZE_MEETING', 'CREATE_TASK', 'ESCALATE', 'NO_ACTION', 'SEND_EMAIL'];
  if (!allowed.includes(actionType)) return null;
  const summary = typeof row.summary === 'string' ? row.summary.slice(0, 240) : '';
  const external = row.external === true || actionType === 'SEND_EMAIL' || actionType === 'DRAFT_MESSAGE';
  return { actionType, external, summary, commercialCommitment: row.commercialCommitment === true };
}

export async function generateWithRepair<T>(
  provider: LlmProvider,
  input: LlmGenerateInput,
  accept: (value: unknown) => T | null,
): Promise<LlmResult<T>> {
  const first = await provider.generateStructured<unknown>(input);
  const parsed = accept(first.result);
  if (parsed) return { ...first, result: parsed };
  const second = await provider.generateStructured<unknown>({
    ...input,
    messages: [...input.messages, { role: 'user', content: 'Return one JSON object that matches the schema.' }],
  });
  const repaired = accept(second.result);
  if (!repaired) throw new LlmSchemaError();
  return {
    ...second,
    result: repaired,
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
    },
  };
}

export async function generateTaskResult(provider: LlmProvider, input: LlmGenerateInput): Promise<LlmResult<Record<string, unknown>>> {
  if (input.task !== 'supervisor.lead.qualification.explain') return provider.generateStructured<Record<string, unknown>>(input);
  const official = officialFromPrompt(input.messages);
  if (!official) return insufficientResult(input.tenantId);
  return explainLead(provider, { ...input, outputSchema: LEAD_EXPLANATION_SCHEMA as unknown as JsonSchema }, official);
}

async function explainLead(provider: LlmProvider, input: LlmGenerateInput, official: OfficialBreakdown): Promise<LlmResult<Record<string, unknown>>> {
  const first = await readModel(provider, input);
  if (first && acceptLeadExplanation(first.result, official)?.quality === 'MODEL') {
    const accepted = acceptLeadExplanation(first.result, official);
    return { ...first, result: { explanationQuality: 'MODEL', summary: accepted && accepted.quality === 'MODEL' ? accepted.text : '' } };
  }
  const second = await readModel(provider, {
    ...input,
    messages: [...input.messages, { role: 'user', content: 'Return one JSON object. Copy the official score, grade, and dimension fits. Name each matched dimension in strengths and each unknown dimension in researchQuestions. Do not restate only the score.' }],
  });
  const repaired = second ? acceptLeadExplanation(second.result, official) : null;
  const usage = {
    inputTokens: (first?.usage.inputTokens ?? 0) + (second?.usage.inputTokens ?? 0),
    outputTokens: (first?.usage.outputTokens ?? 0) + (second?.usage.outputTokens ?? 0),
  };
  if (repaired?.quality === 'MODEL') {
    return { ...(second as LlmResult<unknown>), usage, result: { explanationQuality: 'MODEL', summary: repaired.text } };
  }
  return {
    result: { explanationQuality: 'INSUFFICIENT_EXPLANATION', summary: 'INSUFFICIENT_EXPLANATION' },
    usage,
    model: second?.model ?? first?.model ?? 'none',
    latencyMs: (first?.latencyMs ?? 0) + (second?.latencyMs ?? 0),
    traceId: second?.traceId ?? first?.traceId ?? `trace-${input.tenantId}`,
    usageExact: false,
  };
}

async function readModel(provider: LlmProvider, input: LlmGenerateInput): Promise<LlmResult<unknown> | null> {
  try {
    return await provider.generateStructured<unknown>(input);
  } catch (error) {
    if (error instanceof LlmProviderError && (error.status === 400 || error.status === 502)) return null;
    throw error;
  }
}

function insufficientResult(tenantId: string): LlmResult<Record<string, unknown>> {
  return {
    result: { explanationQuality: 'INSUFFICIENT_EXPLANATION', summary: 'INSUFFICIENT_EXPLANATION' },
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'none',
    latencyMs: 0,
    traceId: `trace-${tenantId}`,
    usageExact: false,
  };
}

export class FakeLlmProvider implements LlmProvider {
  readonly id = 'fake';
  private calls = 0;

  constructor(private readonly script: unknown[] = []) {}

  async generateStructured<T>(input: LlmGenerateInput): Promise<LlmResult<T>> {
    if (this.script.length) {
      const next = this.script[Math.min(this.calls, this.script.length - 1)];
      this.calls += 1;
      return { result: next as T, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake-1', latencyMs: 0, traceId: `trace-${input.tenantId}` };
    }
    if (input.task.startsWith('supervisor.')) {
      const text = input.messages.map((message) => message.content).join('\n');
      const product = /PRODUCT:\s*(.+)/.exec(text)?.[1]?.split('\n')[0]?.trim() || 'unknown product';
      const citationLine = /CITATIONS:\s*(.+)/.exec(text)?.[1]?.split('\n')[0]?.trim() || '';
      return {
        result: {
          summary: `${input.task} for ${product}`,
          strategy: `Strategy for ${product} using approved positioning only`,
          draft: `Draft about ${product}. This draft was not sent.`,
          citations: citationLine ? citationLine.split(',').map((item) => item.trim()).filter(Boolean) : [],
          grounded: true,
        } as T,
        usage: { inputTokens: Math.max(1, input.messages.length), outputTokens: 4 },
        model: 'fake-1',
        latencyMs: 0,
        traceId: `trace-${input.tenantId}`,
        usageExact: false,
      };
    }
    if (input.task === 'agent.propose') {
      const requested = input.messages.map((message) => message.content).join('\n');
      const actionType = requested.includes('TEST') ? 'NO_ACTION' : 'CREATE_TASK';
      return {
        result: { actionType, external: false, summary: 'Internal coordination only' } as T,
        usage: { inputTokens: input.messages.length, outputTokens: 1 },
        model: 'fake-1',
        latencyMs: 0,
        traceId: `trace-${input.tenantId}`,
      };
    }
    const required = input.outputSchema.required ?? [];
    const result: Record<string, unknown> = {};
    for (const key of required) {
      result[key] = key === 'task' ? input.task : true;
    }
    if (required.length === 0) result.ok = true;
    return {
      result: result as T,
      usage: { inputTokens: input.messages.length, outputTokens: 1 },
      model: 'fake-1',
      latencyMs: 0,
      traceId: `trace-${input.tenantId}`,
    };
  }
}
