import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createModelClient } from './gateway';
import { LlmProviderError } from './llm';
import { assertModelEndpoint } from './ssrf';

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('model gateway', () => {
  it('uses the fake adapter only when that provider is selected', async () => {
    const client = await createModelClient({ provider: 'fake', model: 'fake-1', timeoutMs: 1000, maxOutputTokens: 20, allowPrivateHttp: false });
    const result = await client.generateStructured<{ summary: string }>({
      tenantId: 'tenant',
      task: 'supervisor.research',
      promptVersion: 'mvp-1',
      messages: [{ role: 'user', content: 'PRODUCT: Field Kit\nCITATIONS: none' }],
      outputSchema: { type: 'object', required: ['summary'] },
      timeoutMs: 1000,
      maxTokens: 20,
    });
    expect(result.result.summary).toContain('Field Kit');
    expect(result.usageExact).toBe(false);
    await expect(createModelClient({ provider: 'openai_compatible', model: 'gpt', timeoutMs: 1000, maxOutputTokens: 20, allowPrivateHttp: false })).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('blocks metadata and public HTTP, and allows an explicit loopback stub', async () => {
    await expect(assertModelEndpoint('http://169.254.169.254/latest', true)).rejects.toMatchObject({ status: 400 });
    await expect(assertModelEndpoint('https://169.254.169.254/latest', false)).rejects.toMatchObject({ status: 400 });
    await expect(assertModelEndpoint('http://example.com/v1', true)).rejects.toMatchObject({ status: 400 });
    const server = createServer((request, response) => {
      const path = request.url || '';
      if (path.startsWith('/redirect')) {
        response.writeHead(302, { location: 'http://169.254.169.254/' });
        response.end();
        return;
      }
      if (path.startsWith('/limited')) {
        response.writeHead(429);
        response.end('{}');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: path.startsWith('/malformed') ? 'not-json' : '{"summary":"stub"}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const client = await createModelClient({ provider: 'openai_compatible', model: 'stub', baseUrl: `${base}/v1`, timeoutMs: 2000, maxOutputTokens: 20, allowPrivateHttp: true });
    const ok = await client.generateStructured<{ summary: string }>({ tenantId: 't', task: 'supervisor.ping', promptVersion: 'mvp-1', messages: [{ role: 'user', content: 'ping' }], outputSchema: { type: 'object', required: ['summary'] }, timeoutMs: 2000, maxTokens: 20 });
    expect(ok.result.summary).toBe('stub');
    expect(ok.usageExact).toBe(true);
    const limited = await createModelClient({ provider: 'openai_compatible', model: 'stub', baseUrl: `${base}/limited`, timeoutMs: 2000, maxOutputTokens: 20, allowPrivateHttp: true });
    await expect(limited.generateStructured({ tenantId: 't', task: 'supervisor.ping', promptVersion: 'mvp-1', messages: [{ role: 'user', content: 'ping' }], outputSchema: { type: 'object' }, timeoutMs: 2000, maxTokens: 20 })).rejects.toMatchObject({ status: 429 });
    const broken = await createModelClient({ provider: 'openai_compatible', model: 'stub', baseUrl: `${base}/malformed`, timeoutMs: 2000, maxOutputTokens: 20, allowPrivateHttp: true });
    await expect(broken.generateStructured({ tenantId: 't', task: 'supervisor.ping', promptVersion: 'mvp-1', messages: [{ role: 'user', content: 'ping' }], outputSchema: { type: 'object' }, timeoutMs: 2000, maxTokens: 20 })).rejects.toMatchObject({ status: 400 });
    const redirected = await createModelClient({ provider: 'openai_compatible', model: 'stub', baseUrl: `${base}/redirect`, timeoutMs: 2000, maxOutputTokens: 20, allowPrivateHttp: true });
    await expect(redirected.generateStructured({ tenantId: 't', task: 'supervisor.ping', promptVersion: 'mvp-1', messages: [{ role: 'user', content: 'ping' }], outputSchema: { type: 'object' }, timeoutMs: 2000, maxTokens: 20 })).rejects.toMatchObject({ status: 302 });
  });

  it('maps provider failures without falling back to the mock adapter', async () => {
    const server = createServer((request, response) => {
      const path = request.url || '';
      const status = Number(path.split('/').find((part) => /^\d{3}$/.test(part)));
      if (status) {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'provider rejected the model' } }));
        return;
      }
      if (path.startsWith('/empty')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
        return;
      }
      if (path.startsWith('/malformed')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('not-json');
        return;
      }
      if (path.startsWith('/huge')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('x'.repeat(200_001));
        return;
      }
      if (path.startsWith('/slow')) return;
      if (path.startsWith('/drop')) {
        request.socket.destroy();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const call = (path: string, timeoutMs = 1000) => createModelClient({
      provider: path.includes('ollama') ? 'ollama' : 'openai_compatible',
      model: 'missing-model',
      baseUrl: `http://127.0.0.1:${port}${path}`,
      timeoutMs,
      maxOutputTokens: 20,
      allowPrivateHttp: true,
      apiKey: 'stub-secret',
    }).then((client) => client.generateStructured({
      tenantId: 't',
      task: 'supervisor.ping',
      promptVersion: 'mvp-1',
      messages: [{ role: 'user', content: 'ping' }],
      outputSchema: { type: 'object', required: ['summary'] },
      timeoutMs,
      maxTokens: 20,
    }));
    await expect(call('/401')).rejects.toMatchObject({ status: 401 });
    await expect(call('/429')).rejects.toMatchObject({ status: 429 });
    await expect(call('/500')).rejects.toMatchObject({ status: 500 });
    await expect(call('/503')).rejects.toMatchObject({ status: 503 });
    await expect(call('/404')).rejects.toMatchObject({ status: 404 });
    await expect(call('/empty')).rejects.toMatchObject({ status: 502 });
    await expect(call('/malformed')).rejects.toMatchObject({ status: 400 });
    await expect(call('/huge')).rejects.toMatchObject({ status: 502 });
    await expect(call('/slow', 50)).rejects.toMatchObject({ status: 504 });
    await expect(call('/drop')).rejects.toMatchObject({ status: 503 });
    const ollama = await createModelClient({ provider: 'ollama', model: 'local', baseUrl: `http://127.0.0.1:${port}/401`, timeoutMs: 1000, maxOutputTokens: 20, allowPrivateHttp: true });
    await expect(ollama.generateStructured({ tenantId: 't', task: 'supervisor.ping', promptVersion: 'mvp-1', messages: [{ role: 'user', content: 'ping' }], outputSchema: { type: 'object' }, timeoutMs: 1000, maxTokens: 20 })).rejects.toMatchObject({ status: 401 });
  });
});
