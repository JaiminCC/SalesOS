import { mapProviderBusy, type BusyState } from '@salesos/shared';

export type CalendarBusy = { start: string; end: string; state: BusyState };

const GOOGLE = 'https://www.googleapis.com';
const GRAPH = 'https://graph.microsoft.com';

export async function readGoogleFreeBusy(input: { accessToken: string; calendarId: string; timeMin: string; timeMax: string }, fetchImpl: typeof fetch): Promise<CalendarBusy[]> {
  assertToken(input.accessToken);
  const url = new URL(`${GOOGLE}/calendar/v3/freeBusy`);
  const response = await guarded(fetchImpl, url, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin: input.timeMin, timeMax: input.timeMax, items: [{ id: input.calendarId }] }),
  });
  if (response.status === 429) throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
  if (!response.ok) throw new Error(`Google freebusy failed with ${response.status}`);
  const body = await response.json() as { calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }> };
  const busy = body.calendars?.[input.calendarId]?.busy ?? [];
  return busy.filter((item) => item.start && item.end).map((item) => ({ start: item.start!, end: item.end!, state: 'BUSY' as const }));
}

export async function readMicrosoftSchedule(input: { accessToken: string; address: string; timeMin: string; timeMax: string; timeZone: string }, fetchImpl: typeof fetch): Promise<CalendarBusy[]> {
  assertToken(input.accessToken);
  const url = new URL(`${GRAPH}/v1.0/me/calendar/getSchedule`);
  const response = await guarded(fetchImpl, url, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ schedules: [input.address], startTime: { dateTime: input.timeMin, timeZone: input.timeZone }, endTime: { dateTime: input.timeMax, timeZone: input.timeZone }, availabilityViewInterval: 30 }),
  });
  if (response.status === 429) throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
  if (!response.ok) throw new Error(`Microsoft schedule failed with ${response.status}`);
  const body = await response.json() as { value?: Array<{ scheduleItems?: Array<{ status?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; subject?: string }> }> };
  return (body.value?.[0]?.scheduleItems ?? []).flatMap((item) => {
    if (!item.start?.dateTime || !item.end?.dateTime) return [];
    const state = mapProviderBusy(item.status);
    return [{ start: item.start.dateTime, end: item.end.dateTime, state: state === 'FREE' ? 'FREE' as const : state }];
  }).filter((item) => item.state !== 'FREE');
}

export function calendarReadUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'www.googleapis.com' || url.hostname === 'graph.microsoft.com');
  } catch {
    return false;
  }
}

async function guarded(fetchImpl: typeof fetch, url: URL, init: RequestInit): Promise<Response> {
  if (!calendarReadUrlAllowed(url.toString())) throw new Error('PROVIDER_URL_REJECTED');
  const response = await fetchImpl(url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) throw new Error('Provider redirect was refused');
  return response;
}

function assertToken(token: string) {
  if (!token || token.length < 8) throw new Error('NOT_CONFIGURED');
}
