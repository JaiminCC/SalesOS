import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('calendar external write boundary', () => {
  it('does not construct a provider write from the calendar path', () => {
    const files = ['calendar-work.ts', '../../../apps/api/src/calendar/calendar.controller.ts', '../../../apps/api/src/calendar/calendar.service.ts'];
    const processor = readFileSync(new URL('../../../apps/worker/src/processor.ts', import.meta.url), 'utf8');
    const slice = processor.slice(processor.indexOf('export async function processCalendarWorkerJob'), processor.indexOf('export async function scheduleMailboxReads'));
    const combined = files.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n') + slice;
    for (const banned of ['createExternalEvent(', 'events.insert', 'sendUpdates', 'messages/send', 'graph.facebook.com', '/me/sendMail', 'sendDraft(', 'sendWithGmail', 'sendWithGraph', 'fetch(']) {
      expect(combined).not.toContain(banned);
    }
    const gate = readFileSync(new URL('../../../packages/integrations/src/calendar-write.ts', import.meta.url), 'utf8');
    expect(gate.indexOf('throw new CalendarWriteClosed()')).toBeLessThan(gate.indexOf('export function updateExternalEvent'));
    expect(gate).not.toContain('fetch(');
    expect(slice).toContain('processCalendarJob');
  });
});
