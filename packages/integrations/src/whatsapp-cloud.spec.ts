import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sendWhatsAppCloudMessage, submitWhatsAppTemplate } from './whatsapp-cloud';

describe('closed-gate WhatsApp adapter', () => {
  it('fails before any network call', () => {
    const source = readFileSync(new URL('./whatsapp-cloud.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('graph.facebook.com');
    const previous = process.env.SALESOS_LIVE_WHATSAPP_SEND_ENABLED;
    process.env.SALESOS_LIVE_WHATSAPP_SEND_ENABLED = 'true';
    try {
      expect(() => sendWhatsAppCloudMessage()).toThrow(/NOT AUTHORIZED/);
      expect(() => submitWhatsAppTemplate()).toThrow(/NOT AUTHORIZED/);
    } finally {
      if (previous === undefined) delete process.env.SALESOS_LIVE_WHATSAPP_SEND_ENABLED;
      else process.env.SALESOS_LIVE_WHATSAPP_SEND_ENABLED = previous;
    }
    expect(source).not.toContain('SALESOS_LIVE_WHATSAPP_SEND_ENABLED');
  });
});
