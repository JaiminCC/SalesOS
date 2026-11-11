import { describe, expect, it } from 'vitest';
import { calendarReadUrlAllowed, readGoogleFreeBusy, readMicrosoftSchedule } from './calendar-read';

describe('calendar read adapters', () => {
  it('maps busy time and refuses a private redirect', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      calls.push(String(url));
      expect(init?.redirect).toBe('manual');
      expect(String(init?.body)).not.toContain('subject');
      return new Response(JSON.stringify({ calendars: { primary: { busy: [{ start: '2026-11-09T04:00:00Z', end: '2026-11-09T05:00:00Z' }] } } }), { status: 200 });
    }) as typeof fetch;
    const busy = await readGoogleFreeBusy({ accessToken: 'token-value', calendarId: 'primary', timeMin: '2026-11-09T00:00:00Z', timeMax: '2026-11-10T00:00:00Z' }, fetchImpl);
    expect(busy).toEqual([{ start: '2026-11-09T04:00:00Z', end: '2026-11-09T05:00:00Z', state: 'BUSY' }]);
    expect(calls[0]).toContain('https://www.googleapis.com/calendar/v3/freeBusy');
    const graph = (async () => new Response(JSON.stringify({ value: [{ scheduleItems: [{ status: 'oof', subject: 'Private dentist', start: { dateTime: '2026-11-09T06:00:00' }, end: { dateTime: '2026-11-09T07:00:00' } }] }] }), { status: 200 })) as typeof fetch;
    const schedule = await readMicrosoftSchedule({ accessToken: 'token-value', address: 'ada@example.com', timeMin: '2026-11-09T00:00:00', timeMax: '2026-11-10T00:00:00', timeZone: 'UTC' }, graph);
    expect(schedule[0]?.state).toBe('OUT_OF_OFFICE');
    expect(JSON.stringify(schedule)).not.toContain('dentist');
    expect(calendarReadUrlAllowed('http://169.254.169.254/latest')).toBe(false);
    expect(calendarReadUrlAllowed('https://evil.example/calendar')).toBe(false);
    const redirected = (async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })) as typeof fetch;
    await expect(readGoogleFreeBusy({ accessToken: 'token-value', calendarId: 'primary', timeMin: 'a', timeMax: 'b' }, redirected)).rejects.toThrow(/redirect/i);
  });
});
