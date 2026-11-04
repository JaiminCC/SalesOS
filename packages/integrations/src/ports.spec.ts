import { describe, expect, it } from 'vitest';
import { NotConfiguredError } from './errors';
import { UnconfiguredWhatsApp } from './ports';

describe('integration ports', () => {
  it('WhatsApp.send throws NotConfigured', async () => {
    const port = new UnconfiguredWhatsApp();
    await expect(port.send({ tenantId: 't', to: '+10000000000', body: 'hello' })).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
  });
});
