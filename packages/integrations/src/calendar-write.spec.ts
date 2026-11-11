import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createConference, createExternalEvent, deleteExternalEvent, sendCalendarInvitation, updateExternalEvent } from './calendar-write';

describe('closed-gate calendar writes', () => {
  it('rejects every write before a request exists', () => {
    const source = readFileSync(new URL('./calendar-write.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('googleapis.com');
    expect(source).not.toContain('graph.microsoft.com');
    const previous = process.env.SALESOS_LIVE_CALENDAR_WRITE_ENABLED;
    process.env.SALESOS_LIVE_CALENDAR_WRITE_ENABLED = 'true';
    try {
      expect(() => createExternalEvent()).toThrow(/NOT AUTHORIZED/);
      expect(() => updateExternalEvent()).toThrow(/NOT AUTHORIZED/);
      expect(() => deleteExternalEvent()).toThrow(/NOT AUTHORIZED/);
      expect(() => createConference()).toThrow(/NOT AUTHORIZED/);
      expect(() => sendCalendarInvitation()).toThrow(/NOT AUTHORIZED/);
    } finally {
      if (previous === undefined) delete process.env.SALESOS_LIVE_CALENDAR_WRITE_ENABLED;
      else process.env.SALESOS_LIVE_CALENDAR_WRITE_ENABLED = previous;
    }
  });
});
