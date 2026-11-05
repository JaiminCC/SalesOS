import { LlmProviderError, type LlmGenerateInput, type LlmProvider, type LlmResult } from './llm';

type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: unknown;
  redirect?: 'manual';
};

export class HttpStructuredLlm implements LlmProvider {
  readonly id: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    id = 'http',
    private readonly apiKey?: string,
    private readonly ollama = false,
  ) {
    this.id = id;
  }

  async generateStructured<T>(input: LlmGenerateInput): Promise<LlmResult<T>> {
    const started = Date.now();
    const fetchImpl = (globalThis as { fetch?: (url: string, init: FetchInit) => Promise<FetchResponse> }).fetch;
    const timeout = (globalThis as { AbortSignal?: { timeout(ms: number): unknown } }).AbortSignal?.timeout(input.timeoutMs);
    if (!fetchImpl) throw new LlmProviderError(503, 'The model provider is not available in this runtime');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const body = this.ollama
      ? { model: this.model, stream: false, think: false, messages: input.messages, format: input.outputSchema, options: { temperature: 0, num_predict: input.maxTokens } }
      : { model: this.model, max_tokens: input.maxTokens, temperature: 0, messages: input.messages, response_format: { type: 'json_object' } };
    let response: FetchResponse;
    try {
      response = await fetchImpl(this.baseUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: timeout, redirect: 'manual' });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new LlmProviderError(timedOut ? 504 : 503, timedOut ? 'The model provider timed out' : 'The model provider could not be reached');
    }
    if (response.status >= 300 && response.status < 400) throw new LlmProviderError(response.status, 'The model provider redirected the request');
    if (!response.ok) throw new LlmProviderError(response.status, 'The model provider did not accept the request');
    const raw = await response.text();
    if (raw.length > 200_000) throw new LlmProviderError(502, 'The model provider response exceeded the size limit');
    let parsed: {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    try {
      parsed = JSON.parse(raw) as NonNullable<typeof parsed>;
    } catch {
      throw new LlmProviderError(400, 'The model provider returned malformed JSON');
    }
    const content = this.ollama ? parsed.message?.content : parsed.choices?.[0]?.message?.content;
    if (!content) throw new LlmProviderError(502, 'The model provider returned an empty payload');
    const providerInput = parsed.usage?.prompt_tokens ?? parsed.prompt_eval_count;
    const providerOutput = parsed.usage?.completion_tokens ?? parsed.eval_count;
    const reported = providerInput !== undefined && providerOutput !== undefined;
    let result: T;
    try {
      result = JSON.parse(content) as T;
    } catch {
      throw new LlmProviderError(400, 'The model provider returned malformed JSON');
    }
    return {
      result,
      usage: { inputTokens: providerInput ?? input.messages.length, outputTokens: providerOutput ?? 1 },
      model: this.model,
      latencyMs: Date.now() - started,
      traceId: `trace-${input.tenantId}`,
      usageExact: reported,
    };
  }
}
