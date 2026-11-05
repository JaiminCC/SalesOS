import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { LlmProviderError } from './llm';

export async function assertModelEndpoint(baseUrl: string, allowPrivateHttp: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LlmProviderError(400, 'The model endpoint is not a valid URL');
  }
  if (url.username || url.password) throw new LlmProviderError(400, 'The model endpoint cannot embed credentials');
  const loopback = isLoopback(url.hostname);
  if (url.protocol === 'https:') {
    await rejectBlocked(url.hostname, false);
    return url;
  }
  if (url.protocol === 'http:' && allowPrivateHttp && loopback) {
    await rejectBlocked(url.hostname, true);
    return url;
  }
  throw new LlmProviderError(400, 'Remote model endpoints must use HTTPS');
}

async function rejectBlocked(hostname: string, allowLoopback: boolean): Promise<void> {
  if (hostname === 'metadata.google.internal' || hostname.endsWith('.internal')) {
    throw new LlmProviderError(400, 'The model endpoint is not an allowed destination');
  }
  const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0) throw new LlmProviderError(400, 'The model endpoint did not resolve');
  for (const address of addresses) {
    if (isBlockedAddress(address) && !(allowLoopback && isLoopback(address))) {
      throw new LlmProviderError(400, 'The model endpoint is not an allowed destination');
    }
  }
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isBlockedAddress(address: string): boolean {
  if (address === '169.254.169.254' || address.startsWith('169.254.') || address.startsWith('fe80:')) return true;
  if (address.startsWith('10.') || address.startsWith('192.168.') || address.startsWith('127.')) return true;
  const second = Number(address.split('.')[1]);
  if (address.startsWith('172.') && second >= 16 && second <= 31) return true;
  return address === '::1' || address === '0.0.0.0';
}
