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
};

export interface LlmProvider {
  readonly id: string;
  generateStructured<T>(input: LlmGenerateInput): Promise<LlmResult<T>>;
}

export class FakeLlmProvider implements LlmProvider {
  readonly id = 'fake';

  async generateStructured<T>(input: LlmGenerateInput): Promise<LlmResult<T>> {
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
