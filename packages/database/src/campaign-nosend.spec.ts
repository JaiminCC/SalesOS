import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = [
  resolve('src/campaign-work.ts'),
  resolve('../../apps/api/src/campaigns/campaign.service.ts'),
  resolve('../../apps/api/src/campaigns/campaign.controller.ts'),
  resolve('../../apps/worker/src/campaign-crash.ts'),
];

describe('campaign delivery boundary', () => {
  it('does not couple campaign preparation to a provider send', () => {
    const forbidden = [/sendDraft\s*\(/, /sendWithGmail/, /sendWithGraph/, /messages\/send/, /\/me\/sendMail/, /campaign\.email\.send/, /campaign\.whatsapp\.send/, /campaign\.external\.dispatch/];
    for (const path of roots) {
      const text = readFileSync(path, 'utf8');
      for (const pattern of forbidden) expect(text, path).not.toMatch(pattern);
    }
    const processor = readFileSync(resolve('../../apps/worker/src/processor.ts'), 'utf8');
    const campaignWorker = processor.slice(processor.indexOf('export async function processCampaignWorkerJob'), processor.indexOf('export async function scheduleMailboxReads'));
    expect(campaignWorker).toContain('processCampaignJob');
    for (const pattern of forbidden) expect(campaignWorker).not.toMatch(pattern);
  });
});
