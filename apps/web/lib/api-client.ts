export type HealthLiveResponse = {
  data: { status: 'live' };
  meta: { requestId: string };
};

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3001';
}

export async function getHealthLive(signal?: AbortSignal): Promise<HealthLiveResponse> {
  const response = await fetch(`${apiBaseUrl()}/health/live`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Health check failed with status ${response.status}`);
  return (await response.json()) as HealthLiveResponse;
}
