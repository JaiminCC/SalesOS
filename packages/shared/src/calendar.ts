export const CALENDAR_WRITE_STATES = ['NOT_ATTEMPTED', 'CLOSED_GATE'] as const;

export type CalendarReadiness =
  | 'NOT_CONFIGURED'
  | 'CONFIGURATION_INVALID'
  | 'CONFIGURED_UNVERIFIED'
  | 'AUTHORIZATION_REQUIRED'
  | 'CONNECTED_UNVERIFIED'
  | 'READ_ACCESS_VERIFIED'
  | 'SCOPE_MISSING'
  | 'TOKEN_EXPIRED'
  | 'REAUTH_REQUIRED'
  | 'DEGRADED'
  | 'DISCONNECTED';

export type BusyState = 'FREE' | 'BUSY' | 'TENTATIVE' | 'OUT_OF_OFFICE' | 'WORKING_ELSEWHERE' | 'UNKNOWN';
export type SlotState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' | 'CONFLICT' | 'NEEDS_PROVIDER_VERIFICATION';
export type AvailabilityMode = 'LOCAL_ONLY' | 'PROVIDER_VALIDATED';

export type BusyWindow = { start: string; end: string; state: BusyState };
export type WorkingWindow = { weekday: number; startMinute: number; endMinute: number };

export type CalendarEnv = {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  MICROSOFT_OAUTH_CLIENT_ID?: string;
  MICROSOFT_OAUTH_CLIENT_SECRET?: string;
  SALESOS_LIVE_CALENDAR_WRITE_ENABLED?: string;
  NODE_ENV?: string;
  CI?: string;
};

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function liveCalendarWriteEnabled(env: CalendarEnv): boolean {
  if (env.NODE_ENV === 'test' || env.CI === 'true') return false;
  return env.SALESOS_LIVE_CALENDAR_WRITE_ENABLED === 'true';
}

export function calendarProviderReadiness(provider: 'GOOGLE_CALENDAR' | 'MICROSOFT_CALENDAR', env: CalendarEnv): CalendarReadiness {
  const id = provider === 'GOOGLE_CALENDAR' ? env.GOOGLE_OAUTH_CLIENT_ID : env.MICROSOFT_OAUTH_CLIENT_ID;
  const secret = provider === 'GOOGLE_CALENDAR' ? env.GOOGLE_OAUTH_CLIENT_SECRET : env.MICROSOFT_OAUTH_CLIENT_SECRET;
  if (!id?.trim() && !secret?.trim()) return 'NOT_CONFIGURED';
  if (!id?.trim() || !secret?.trim() || secret.trim().length < 8) return 'CONFIGURATION_INVALID';
  return 'AUTHORIZATION_REQUIRED';
}

export function mapProviderBusy(value: string | undefined): BusyState {
  const name = (value ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (name === 'free') return 'FREE';
  if (name === 'busy') return 'BUSY';
  if (name === 'tentative') return 'TENTATIVE';
  if (name === 'oof' || name === 'outofoffice') return 'OUT_OF_OFFICE';
  if (name === 'workingelsewhere') return 'WORKING_ELSEWHERE';
  return 'UNKNOWN';
}

export function zonedLocalToUtc(local: string, timeZone: string): { utc: Date } | { error: 'INVALID' | 'NONEXISTENT' | 'AMBIGUOUS' } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match || !validZone(timeZone)) return { error: 'INVALID' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return { error: 'INVALID' };
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let utc = desired;
  for (let pass = 0; pass < 3; pass += 1) utc = desired - (wallAsUtc(utc, timeZone) - utc);
  const matches = [-120, -60, 0, 60, 120]
    .map((delta) => utc + delta * 60_000)
    .filter((instant) => sameWall(instant, year, month, day, hour, minute, timeZone));
  const unique = [...new Set(matches)];
  if (unique.length === 0) return { error: 'NONEXISTENT' };
  if (unique.length > 1) return { error: 'AMBIGUOUS' };
  return { utc: new Date(unique[0]!) };
}

export function formatInZone(instant: Date, timeZone: string): string {
  const parts = wall(instant.getTime(), timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function suggestSlots(input: {
  zone: string;
  fromDate: string;
  throughDate: string;
  durationMinutes: number;
  incrementMinutes: number;
  noticeMinutes: number;
  horizonDays: number;
  bufferBefore: number;
  bufferAfter: number;
  workingHours: WorkingWindow[];
  blockedDates: string[];
  busy: BusyWindow[];
  now: Date;
  mode: AvailabilityMode;
  providerUnknown?: boolean;
}): Array<{ start: string; end: string; localStart: string; state: SlotState; mode: AvailabilityMode }> {
  if (input.mode === 'PROVIDER_VALIDATED' && input.providerUnknown) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.throughDate)) {
    throw Object.assign(new Error('INVALID_RANGE'), { code: 'INVALID_RANGE' });
  }
  const startDay = Date.parse(`${input.fromDate}T00:00:00Z`);
  const endDay = Date.parse(`${input.throughDate}T00:00:00Z`);
  if (!Number.isFinite(startDay) || endDay < startDay || (endDay - startDay) / 86_400_000 > 31) {
    throw Object.assign(new Error('RANGE_TOO_WIDE'), { code: 'RANGE_TOO_WIDE' });
  }
  const horizon = input.now.getTime() + input.horizonDays * 86_400_000;
  const notice = input.now.getTime() + input.noticeMinutes * 60_000;
  const blocked = new Set(input.blockedDates);
  const slots = [];
  for (let day = startDay; day <= endDay && slots.length < 48; day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    if (blocked.has(date)) continue;
    for (const window of input.workingHours) {
      for (let minute = window.startMinute; minute + input.durationMinutes <= window.endMinute && slots.length < 48; minute += input.incrementMinutes) {
        const local = `${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
        const converted = zonedLocalToUtc(local, input.zone);
        if ('error' in converted) continue;
        if (weekdayInZone(converted.utc, input.zone) !== window.weekday) continue;
        const end = new Date(converted.utc.getTime() + input.durationMinutes * 60_000);
        if (converted.utc.getTime() < notice || end.getTime() > horizon) continue;
        const bufferedStart = converted.utc.getTime() - input.bufferBefore * 60_000;
        const bufferedEnd = end.getTime() + input.bufferAfter * 60_000;
        const overlap = input.busy.filter((item) => Date.parse(item.start) < bufferedEnd && Date.parse(item.end) > bufferedStart);
        const unknown = overlap.some((item) => item.state === 'UNKNOWN');
        const blocking = overlap.some((item) => item.state !== 'FREE' && item.state !== 'UNKNOWN');
        const state: SlotState = unknown ? 'UNKNOWN' : blocking ? 'CONFLICT' : input.mode === 'PROVIDER_VALIDATED' ? 'AVAILABLE' : 'AVAILABLE';
        if (state !== 'AVAILABLE') continue;
        slots.push({ start: converted.utc.toISOString(), end: end.toISOString(), localStart: local, state, mode: input.mode });
      }
    }
  }
  return slots;
}

export function classifyMeetingIntent(text: string): { intent: 'DEMO_REQUEST' | 'DISCOVERY_CALL' | 'FOLLOW_UP_MEETING' | 'TECHNICAL_DISCUSSION' | 'PRODUCT_WALKTHROUGH' | 'SUPPORT_MEETING' | 'UNKNOWN'; review: 'REVIEW_REQUIRED' } {
  const value = text.toLowerCase();
  const intent = value.includes('demo') || value.includes('demonstration')
    ? 'DEMO_REQUEST'
    : value.includes('discovery')
      ? 'DISCOVERY_CALL'
      : value.includes('follow')
        ? 'FOLLOW_UP_MEETING'
        : value.includes('technical')
          ? 'TECHNICAL_DISCUSSION'
          : value.includes('walkthrough')
            ? 'PRODUCT_WALKTHROUGH'
            : value.includes('support')
              ? 'SUPPORT_MEETING'
              : 'UNKNOWN';
  return { intent, review: 'REVIEW_REQUIRED' };
}

export function acceptMeetingProposal(value: unknown, allowed: { slots: string[]; agendaPhrase?: string; accountName?: string } = { slots: [] }): { accepted: boolean; review: 'REVIEW_REQUIRED'; slot: string | null; agenda: string } {
  const record = proposalRecord(value);
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const invented = /meet\.google\.com|teams\.microsoft\.com|booked on google|booked on outlook|invitation sent|https?:\/\//i.test(text);
  const proposedSlot = String(record.slot ?? '').trim();
  const slot = allowed.slots.find((item) => item === proposedSlot) ?? null;
  const agenda = String(record.agenda ?? '').trim();
  const summary = String(record.summary ?? '');
  const phrase = (allowed.agendaPhrase ?? '').toLowerCase().trim();
  const account = allowed.accountName ?? '';
  const availability = String(record.availability ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const grounded = Boolean(slot)
    && availability === 'LOCAL_ONLY'
    && agenda.length >= 8
    && !/\$\s?\d/.test(agenda)
    && (!phrase || agenda.toLowerCase().includes(phrase))
    && (!account || summary.includes(account))
    && !invented;
  if (!grounded || !slot) return { accepted: false, review: 'REVIEW_REQUIRED', slot: null, agenda: '' };
  return { accepted: true, review: 'REVIEW_REQUIRED', slot, agenda: agenda.slice(0, 4000) };
}

export function intervalsOverlap(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function proposalRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function validZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function wall(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  let hour = Number(value('hour'));
  if (hour === 24) hour = 0;
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')), hour, minute: Number(value('minute')), weekday: WEEKDAYS[value('weekday')] ?? 0 };
}

function wallAsUtc(instant: number, timeZone: string): number {
  const parts = wall(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function sameWall(instant: number, year: number, month: number, day: number, hour: number, minute: number, timeZone: string): boolean {
  const parts = wall(instant, timeZone);
  return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
}

function weekdayInZone(instant: Date, timeZone: string): number {
  return wall(instant.getTime(), timeZone).weekday;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
