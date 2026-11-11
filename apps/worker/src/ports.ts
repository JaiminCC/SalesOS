import { UnconfiguredCalendar, UnconfiguredMailbox, UnconfiguredWhatsApp } from '@salesos/integrations';

export function externalPorts() {
  return {
    mailbox: new UnconfiguredMailbox(),
    whatsapp: new UnconfiguredWhatsApp(),
    calendar: new UnconfiguredCalendar(),
  };
}
