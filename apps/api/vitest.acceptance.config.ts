import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/crm/lead-model.acceptance.ts', 'src/mailbox/inbox-model.acceptance.ts', 'src/campaigns/campaign-model.acceptance.ts', 'src/whatsapp/whatsapp-model.acceptance.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 60_000,
    setupFiles: ['./vitest.setup.ts'],
  },
});