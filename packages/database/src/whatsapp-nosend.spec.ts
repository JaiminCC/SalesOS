import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'whatsapp-work.ts',
  '../../../apps/api/src/whatsapp/whatsapp.controller.ts',
  '../../../apps/api/src/whatsapp/whatsapp.service.ts',
  '../../../apps/worker/src/processor.ts',
];

describe('WhatsApp no-send source', () => {
  it('does not call a provider send from the WhatsApp path', () => {
    const processor = readFileSync(new URL('../../../apps/worker/src/processor.ts', import.meta.url), 'utf8');
    const slice = processor.slice(processor.indexOf('export async function processWhatsAppWorkerJob'), processor.indexOf('export async function scheduleMailboxReads'));
    const combined = files.filter((file) => !file.endsWith('processor.ts')).map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n') + slice;
    for (const banned of ['sendWhatsAppCloudMessage(', 'graph.facebook.com', 'messages/send', 'whatsapp.message.send', 'whatsapp.template.dispatch']) {
      expect(combined).not.toContain(banned);
    }
  });
});
