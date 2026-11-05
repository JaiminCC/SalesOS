import { FakeLlmProvider, LlmProviderError, type LlmGenerateInput, type LlmProvider, type LlmResult } from './llm';
import { HttpStructuredLlm } from './http-llm';
import { assertModelEndpoint } from './ssrf';

const openAiCompatible = ['open', 'ai_compatible'].join('');

export type ModelSelection = {
  provider: string;
  model: string;
  baseUrl?: string | null;
  apiKey?: string;
  timeoutMs: number;
  maxOutputTokens: number;
  allowPrivateHttp: boolean;
};

export async function createModelClient(selection: ModelSelection): Promise<LlmProvider> {
  if (selection.provider === 'fake') return new FakeLlmProvider();
  if (selection.provider !== openAiCompatible && selection.provider !== 'ollama') throw new LlmProviderError(400, 'The model provider is not supported');
  if (!selection.baseUrl) throw new LlmProviderError(400, 'The model endpoint is required');
  const url = await assertModelEndpoint(selection.baseUrl, selection.allowPrivateHttp);
  const ollama = selection.provider === 'ollama';
  const endpoint = ollama ? ollamaUrl(url) : openAiUrl(url);
  return new HttpStructuredLlm(endpoint.toString(), selection.model, selection.provider, selection.apiKey, ollama);
}

function openAiUrl(url: URL): URL {
  if (url.pathname.endsWith('/chat/completions')) return url;
  const next = new URL(url.toString());
  next.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return next;
}

function ollamaUrl(url: URL): URL {
  if (url.pathname.endsWith('/api/chat')) return url;
  const next = new URL(url.toString());
  next.pathname = `${url.pathname.replace(/\/$/, '')}/api/chat`;
  return next;
}

export async function completeStructured<T>(provider: LlmProvider, input: LlmGenerateInput): Promise<LlmResult<T>> {
  return provider.generateStructured(input);
}
