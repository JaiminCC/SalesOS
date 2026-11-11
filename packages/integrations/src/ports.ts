import { CalendarWriteClosed } from './calendar-write';
import { NotConfiguredError } from './errors';

export type TenantCall = { tenantId: string };

export interface Mailbox {
  send(input: TenantCall & { messageId: string }): Promise<{ providerMessageId: string }>;
}

export interface Calendar {
  book(input: TenantCall & { slotId: string }): Promise<{ providerEventId: string }>;
}

export interface ResearchSource {
  fetch(input: TenantCall & { url: string }): Promise<{ excerpt: string }>;
}

export interface MeetingArtifactPort {
  register(input: TenantCall & { meetingId: string }): Promise<{ artifactId: string }>;
}

export interface WhatsApp {
  send(input: TenantCall & { to: string; body: string }): Promise<{ providerMessageId: string }>;
}

function closed(port: string, method: string): Promise<never> {
  return Promise.reject(new NotConfiguredError(port, method));
}

export class UnconfiguredMailbox implements Mailbox {
  send(): Promise<{ providerMessageId: string }> {
    return closed('Mailbox', 'send');
  }
}

export class UnconfiguredCalendar implements Calendar {
  book(): Promise<{ providerEventId: string }> {
    throw new CalendarWriteClosed();
  }
}

export class UnconfiguredResearchSource implements ResearchSource {
  fetch(): Promise<{ excerpt: string }> {
    return closed('ResearchSource', 'fetch');
  }
}

export class UnconfiguredMeetingArtifact implements MeetingArtifactPort {
  register(): Promise<{ artifactId: string }> {
    return closed('MeetingArtifact', 'register');
  }
}

export class UnconfiguredWhatsApp implements WhatsApp {
  send(): Promise<{ providerMessageId: string }> {
    return closed('WhatsApp', 'send');
  }
}
