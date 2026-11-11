import { describe, expect, it } from 'vitest';
import { acceptMeetingProposal, calendarProviderReadiness, liveCalendarWriteEnabled, mapProviderBusy, suggestSlots, zonedLocalToUtc } from './calendar';

describe('calendar policy', () => {
  it('keeps an unconfigured provider closed and refuses a live write in test', () => {
    expect(calendarProviderReadiness('GOOGLE_CALENDAR', {})).toBe('NOT_CONFIGURED');
    expect(calendarProviderReadiness('MICROSOFT_CALENDAR', { MICROSOFT_OAUTH_CLIENT_ID: 'app' })).toBe('CONFIGURATION_INVALID');
    expect(calendarProviderReadiness('GOOGLE_CALENDAR', { GOOGLE_OAUTH_CLIENT_ID: 'app', GOOGLE_OAUTH_CLIENT_SECRET: 'secret-value' })).toBe('AUTHORIZATION_REQUIRED');
    expect(liveCalendarWriteEnabled({ SALESOS_LIVE_CALENDAR_WRITE_ENABLED: 'true', NODE_ENV: 'test' })).toBe(false);
    expect(liveCalendarWriteEnabled({ SALESOS_LIVE_CALENDAR_WRITE_ENABLED: 'true', CI: 'true' })).toBe(false);
  });

  it('converts IANA times and rejects skipped or repeated local times', () => {
    const kolkata = zonedLocalToUtc('2026-01-15T10:00', 'Asia/Kolkata');
    expect('utc' in kolkata && kolkata.utc.toISOString()).toBe('2026-01-15T04:30:00.000Z');
    expect(zonedLocalToUtc('2026-03-08T02:30', 'America/New_York')).toEqual({ error: 'NONEXISTENT' });
    expect(zonedLocalToUtc('2026-11-01T01:30', 'America/New_York')).toEqual({ error: 'AMBIGUOUS' });
    expect(zonedLocalToUtc('2026-03-29T01:30', 'Europe/London')).toEqual({ error: 'NONEXISTENT' });
    expect(zonedLocalToUtc('2026-06-01T09:00', 'Not/AZone')).toEqual({ error: 'INVALID' });
  });

  it('offers local slots and does not treat unknown provider time as free', () => {
    const slots = suggestSlots({
      zone: 'Asia/Kolkata',
      fromDate: '2026-11-09',
      throughDate: '2026-11-09',
      durationMinutes: 30,
      incrementMinutes: 30,
      noticeMinutes: 0,
      horizonDays: 30,
      bufferBefore: 0,
      bufferAfter: 15,
      workingHours: [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
      blockedDates: [],
      busy: [{ start: '2026-11-09T04:00:00.000Z', end: '2026-11-09T04:30:00.000Z', state: 'UNKNOWN' }],
      now: new Date('2026-11-09T00:00:00.000Z'),
      mode: 'LOCAL_ONLY',
    });
    expect(slots.every((slot) => slot.mode === 'LOCAL_ONLY')).toBe(true);
    expect(slots.some((slot) => slot.localStart === '2026-11-09T09:30')).toBe(false);
    expect(slots.some((slot) => slot.localStart === '2026-11-09T10:00')).toBe(true);
    expect(mapProviderBusy('oof')).toBe('OUT_OF_OFFICE');
    expect(mapProviderBusy('private')).toBe('UNKNOWN');
  });

  it('applies notice, horizon, buffers, blocked dates, and half-open edges', () => {
    const base = {
      zone: 'Asia/Kolkata',
      fromDate: '2026-11-09',
      throughDate: '2026-11-09',
      durationMinutes: 30,
      incrementMinutes: 30,
      noticeMinutes: 0,
      horizonDays: 1,
      bufferBefore: 0,
      bufferAfter: 0,
      workingHours: [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
      blockedDates: [] as string[],
      busy: [] as Array<{ start: string; end: string; state: 'BUSY' | 'FREE' }>,
      now: new Date('2026-11-09T03:00:00.000Z'),
      mode: 'LOCAL_ONLY' as const,
    };
    expect(suggestSlots({ ...base, blockedDates: ['2026-11-09'] })).toEqual([]);
    expect(suggestSlots({ ...base, horizonDays: 0 })).toEqual([]);
    expect(suggestSlots({ ...base, noticeMinutes: 120 }).some((slot) => slot.localStart === '2026-11-09T09:00')).toBe(false);
    const buffered = suggestSlots({ ...base, bufferAfter: 15, busy: [{ start: '2026-11-09T04:00:00.000Z', end: '2026-11-09T04:15:00.000Z', state: 'BUSY' }] });
    expect(buffered.some((slot) => slot.localStart === '2026-11-09T09:00')).toBe(false);
    const open = suggestSlots({ ...base, busy: [{ start: '2026-11-09T04:00:00.000Z', end: '2026-11-09T04:30:00.000Z', state: 'BUSY' }] });
    expect(open.some((slot) => slot.localStart === '2026-11-09T09:00')).toBe(true);
    expect(open.some((slot) => slot.localStart === '2026-11-09T09:30')).toBe(false);
  });

  it('accepts only a grounded local proposal', () => {
    const allowed = { slots: ['2026-11-12T09:00'], agendaPhrase: 'offline barcode capture', accountName: 'Fixture Mills' };
    const accepted = acceptMeetingProposal({
      summary: 'Fixture Mills asked for a demonstration',
      agenda: 'Discuss offline barcode capture and the next internal step.',
      slot: '2026-11-12T09:00',
      availability: 'LOCAL_ONLY',
    }, allowed);
    expect(accepted).toMatchObject({ accepted: true, review: 'REVIEW_REQUIRED', slot: '2026-11-12T09:00' });
    expect(acceptMeetingProposal({ summary: 'Fixture Mills', agenda: 'Discuss offline barcode capture.', slot: '2026-11-12T11:00', availability: 'LOCAL_ONLY' }, allowed).accepted).toBe(false);
    expect(acceptMeetingProposal({ summary: 'Fixture Mills', agenda: 'Join https://meet.google.com/abc and discuss offline barcode capture.', slot: '2026-11-12T09:00', availability: 'LOCAL_ONLY' }, allowed).accepted).toBe(false);
    expect(acceptMeetingProposal('booked on outlook', allowed).accepted).toBe(false);
    expect(acceptMeetingProposal({ summary: 'Fixture Mills', agenda: 'Discuss offline barcode capture.', slot: '2026-11-12T09:00', availability: 'FREE' }, allowed).accepted).toBe(false);
    const fenced = acceptMeetingProposal('```json\n{"summary":"Fixture Mills asked for a demonstration","agenda":"Discuss offline barcode capture and next steps.","slot":"2026-11-12T09:00","availability":"local only"}\n```', allowed);
    expect(fenced).toMatchObject({ accepted: true, review: 'REVIEW_REQUIRED', slot: '2026-11-12T09:00' });
    expect(zonedLocalToUtc('2026-10-25T01:30', 'Europe/London')).toEqual({ error: 'AMBIGUOUS' });
  });

  it('does not offer local time as provider-verified when the provider is unknown', () => {
    const base = {
      zone: 'Asia/Kolkata',
      fromDate: '2026-11-09',
      throughDate: '2026-11-09',
      durationMinutes: 30,
      incrementMinutes: 30,
      noticeMinutes: 0,
      horizonDays: 1,
      bufferBefore: 0,
      bufferAfter: 0,
      workingHours: [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
      blockedDates: [] as string[],
      busy: [] as Array<{ start: string; end: string; state: 'BUSY' }>,
      now: new Date('2026-11-09T03:00:00.000Z'),
      mode: 'PROVIDER_VALIDATED' as const,
      providerUnknown: true,
    };
    expect(suggestSlots(base)).toEqual([]);
  });
});
